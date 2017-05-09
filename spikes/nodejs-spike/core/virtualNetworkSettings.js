let _ = require('../lodashMixins.js');
let v = require('./validation.js');
let r = require('./resources.js');
let validationMessages = require('./validationMessages.js');

let virtualNetworkSettingsDefaults = {
    addressPrefixes: ["10.0.0.0/16"],
    subnets: [
        {
            name: "default",
            addressPrefix: "10.0.1.0/24"
        }
    ],
    dnsServers: [],
    virtualNetworkPeerings: []
};

let virtualNetworkPeeringsSettingsDefaults = {
    allowForwardedTraffic: false,
    allowGatewayTransit: false,
    useRemoteGateways: false
}

let virtualNetworkSettingsSubnetsValidations = {
    name: v.utilities.isNotNullOrWhitespace,
    addressPrefix: v.utilities.networking.isValidCidr
};

let virtualNetworkSettingsPeeringValidations = {
    name: (value, parent) => {
        // Undefined is okay, as it will be generated, but null or whitespace is not.
        if (_.isUndefined(value)) {
            return {
                result: true
            };
        } else {
            return {
                result: v.utilities.isNotNullOrWhitespace(value),
                message: 'name must not be null or only whitespace'
            };
        }
    },
    remoteVirtualNetwork: {
        name: v.utilities.isNotNullOrWhitespace
    },
    allowForwardedTraffic: _.isBoolean,
    allowGatewayTransit: _.isBoolean,
    useRemoteGateways: _.isBoolean
};

let virtualNetworkSettingsValidations = {
    name: v.utilities.isNotNullOrWhitespace,
    addressPrefixes: v.utilities.networking.isValidCidr,
    subnets: virtualNetworkSettingsSubnetsValidations,
    dnsServers: (value, parent) => {
        // An empty array is okay
        let result = {
            result: true
        };

        if (_.isNil(value)) {
            result = {
                result: false,
                message: validationMessages.ValueCannotBeNull
            };
        } else if (value.length > 0) {
            result = {
                validations: v.utilities.networking.isValidIpAddress
            };
        }
        
        return result;
    },
    virtualNetworkPeerings: (value, parent) => {
        // An empty array is okay
        let result = {
            result: true
        };

        if (_.isNil(value)) {
            result = {
                result: false,
                message: validationMessages.ValueCannotBeNull
            };
        } else if (value.length > 0) {
            result = {
                validations: virtualNetworkSettingsPeeringValidations
            };
        }

        return result;
    }
};

function transform(settings) {
    return {
        name: settings.name,
        resourceGroupName: settings.resourceGroupName,
        subscriptionId: settings.subscriptionId,
        properties: {
            addressSpace: {
                addressPrefixes: settings.addressPrefixes
            },
            subnets: _.map(settings.subnets, (value, index) => {
                return {
                    name: value.name,
                    properties: {
                        addressPrefix: value.addressPrefix
                    }
                }
            }),
            dhcpOptions: {
                dnsServers: settings.dnsServers
            }
        }
    };
}

function transformVirtualNetworkPeering({settings, parentSettings}) {
    let peeringName = settings.name ? settings.name : `${settings.remoteVirtualNetwork.name}-peer`;
    return {
        name: `${parentSettings.name}/${peeringName}`,
        properties: {
            remoteVirtualNetwork: {
                id: r.resourceId(settings.remoteVirtualNetwork.subscriptionId, settings.remoteVirtualNetwork.resourceGroupName,
                    'Microsoft.Network/virtualNetworks', settings.remoteVirtualNetwork.name)
            },
            allowForwardedTraffic: settings.allowForwardedTraffic,
            allowGatewayTransit: settings.allowGatewayTransit,
            useRemoteGateways: settings.useRemoteGateways
        }
    };
}

let mergeCustomizer = function (objValue, srcValue, key, object, source, stack) {
    if (key === "subnets") {
        if ((!_.isNil(srcValue)) && (_.isArray(srcValue)) && (srcValue.length > 0)) {
            return srcValue;
        }
    }

    if (key === "virtualNetworkPeerings") {
        if ((srcValue) && (_.isArray(srcValue)) && (srcValue.length > 0)) {
            return _.map(srcValue, (value) => v.merge(value, virtualNetworkPeeringsSettingsDefaults));
        }
    }
};

exports.transform = function ({ settings, buildingBlockSettings }) {
    if (_.isPlainObject(settings)) {
        settings = [settings];
    }

    let results = _.transform(settings, (result, setting, index) => {
        let merged = v.merge(setting, virtualNetworkSettingsDefaults, mergeCustomizer);
        let errors = v.validate({
            settings: merged,
            validations: virtualNetworkSettingsValidations
        });

        if (errors.length > 0) {
          throw new Error(JSON.stringify(errors));
        }

        result.push(merged);
    }, []);

    buildingBlockErrors = v.validate({
        settings: buildingBlockSettings,
        validations: {
            subscriptionId: v.utilities.isNotNullOrWhitespace,
            resourceGroupName: v.utilities.isNotNullOrWhitespace
        }
    });

    if (buildingBlockErrors.length > 0) {
        throw new Error(JSON.stringify(buildingBlockErrors));
    }

    results = _.transform(results, (result, setting) => {
        setting = r.setupResources(setting, buildingBlockSettings, (parentKey) => {
            return ((parentKey === null) || (parentKey === "remoteVirtualNetwork"));
        });

        result.virtualNetworks.push(transform(setting));
        if ((setting.virtualNetworkPeerings) && (setting.virtualNetworkPeerings.length > 0)) {
            result.virtualNetworkPeerings = result.virtualNetworkPeerings.concat(_.transform(setting.virtualNetworkPeerings,
                (result, virtualNetworkPeeringSettings) => {
                    result.push(transformVirtualNetworkPeering({settings: virtualNetworkPeeringSettings, parentSettings: setting}));
                }, []));
        }
    }, {
        virtualNetworks: [],
        virtualNetworkPeerings: []
    });

    return { settings: results };
};
//
//  checkoutZone.js
//
//  Created by Rebecca Stankus on 9/29/17.
//  Copyright 2017 High Fidelity, Inc.
//
//  Distributed under the Apache License, Version 2.0.
//  See the accompanying file LICENSE or http://www.apache.org/licenses/LICENSE-2.0.html
//
//  This zone will provide an area at which a user may purchase an item. When the avatar enters the zone wearing a 
//  marketplace item, the item will appear as a small overlay. Scanning the overlay will cause the 
//  the tablet to open to the marketplace home page for that item, allowing the user to quickly make the purchase.
(function () {
    var SHARED = Script.require('../attachmentZoneShared.js');
    var ITEM_HEIGHT = 0.1;
    var HALF = 0.5;
    var ITEM_OFFSET = {x: 1.5, y: 1.25, z: 0.75};
    var VERTICAL_SPACING = 6;
    var OVERLAY_PREFIX = 'MP';
    var TRANSFORMS_SETTINGS = 'io.highfidelity.avatarStore.checkOut.tranforms';
    var APP_NAME = "CHECKOUT";
    var APP_URL = "https://hifi-content.s3.amazonaws.com/rebecca/CheckoutZone/CheckoutWelcome.html";
    var OVERLAY_ROTATIONAL_OFFSET = { x: 10, y: 140, z: 0 };
    var TABLET_LOCAL_POSITION_OFFSET = { x: 0.01, y: 0.9, z: -0.6 };
    var APP_ICON = "https://hifi-content.s3.amazonaws.com/rebecca/CheckoutZone/shoppingCart.svg";
    var TABLET = Tablet.getTablet("com.highfidelity.interface.tablet.system");
    var TABLET_ROTATIONAL_OFFSET = { x: 10, y: 240, z: 0 };
    
    var _this = this;
    var isInZone = false;
    var tableProperties, tableHeight, tableLength, tableID, spawnZ, spawnY, spawnX;
    var zoneID;
    var replicaList = [];
    var replicaStoredTransforms = {};
    var left = true;
    var button;

    this.preload = function(entityID) {
        zoneID = entityID;
    };

    var getTransformForMarketplaceItems = function() {
        return Settings.getValue(TRANSFORMS_SETTINGS, {});
    };
    
    var getTransformsForMarketplaceItem = function(marketplaceID) {
        var transformItems = getTransformForMarketplaceItems();
        if (transformItems[marketplaceID] === undefined) {
            return {
                certificateTransforms: {},
                unsortedTransforms: [],
                lastUsedUnsortedTransformIndex: -1
            };
        }
        return transformItems[marketplaceID];
    };
    
    var addTransformForMarketplaceItem = function(marketplaceID, certificateID, transform) {
        if (marketplaceID === undefined) {
            return;
        }
        var marketplaceItemTransforms = getTransformForMarketplaceItems();
        var marketplaceItemTransform = getTransformsForMarketplaceItem(marketplaceID);
        if (certificateID !== undefined) {
            marketplaceItemTransform.certificateTransforms[certificateID] = transform;
        } else {
            marketplaceItemTransform.unsortedTransforms.push(transform);
        }
        marketplaceItemTransforms[marketplaceID] = marketplaceItemTransform;
        Settings.setValue(TRANSFORMS_SETTINGS, marketplaceItemTransforms);
    };

    // Get info on checkout stand so we can place copies of items on it for purchasing
    // Find the position of the top of the stand at one end
    var getCheckoutStandPosition = (function() {
        var zoneChildren = Entities.getChildrenIDs(zoneID);
        zoneChildren.forEach(function (childID) {
            var name = Entities.getEntityProperties(childID, 'name').name;
            if (name === "Checkout Table") {
                tableProperties = Entities.getEntityProperties(childID, ['id', 'position', 'dimensions', 'rotation']);
                tableID = tableProperties.id;
                tableHeight = tableProperties.dimensions.y;
                tableLength = tableProperties.dimensions.x;
                
                var halfTableHeight = HALF * tableHeight;
                var verticalSpace = VERTICAL_SPACING * ITEM_HEIGHT;
                spawnY = halfTableHeight + verticalSpace;
                var halfTableLength = HALF * tableLength;
                spawnZ = (halfTableLength);
                spawnX = 0;
            }
        });
    });

    // Spawn a copy of each attachment scaled down to fit the ITEM_HEIGHT and place it on the checkout table
    var spawnOverlayReplica = (function(entityID) {
        var entityProperties = Entities.getEntityProperties(entityID, [
            'name', 'modelURL', 'type', 'dimensions', 'marketplaceID', 'modelURL',
            'localPosition', 'localRotation', 'dimensions', 'parentJointIndex'
        ]);
        var overlayProperties = {
            url: entityProperties.modelURL,
            name: OVERLAY_PREFIX + entityProperties.marketplaceID,
            alpha: true,
            grabbable: true,
            parentID: tableID,
            localPosition: {x: spawnX, y: spawnY, z: spawnZ},
            localRotation: Quat.fromVec3Degrees(OVERLAY_ROTATIONAL_OFFSET),
            // clone dimensions so we can alter it without messing up the original entities dimensions
            dimensions: JSON.parse(JSON.stringify(entityProperties.dimensions))
        };
        var scale = (ITEM_HEIGHT / overlayProperties.dimensions.y);
        if ((overlayProperties.dimensions.x > ITEM_HEIGHT) || (overlayProperties.dimensions.y > ITEM_HEIGHT) || (overlayProperties.dimensions.y > ITEM_HEIGHT)) {
            overlayProperties.dimensions.y = ITEM_HEIGHT;
            overlayProperties.dimensions.x *= scale;
            overlayProperties.dimensions.z *= scale;
        }
        // check that the item is not too large
        var maxItemSize = 0.3;
        var scaleReduction;
        while (overlayProperties.dimensions.x > maxItemSize || overlayProperties.dimensions.z > maxItemSize) {
            scale *= scaleReduction;
            overlayProperties.dimensions.x *= scale;
            overlayProperties.dimensions.y *= scale;
            overlayProperties.dimensions.z *= scale;
        }
        var replica = Overlays.addOverlay("model", overlayProperties);
        var replicaStoredTransform = {
            position: entityProperties.localPosition,
            rotation: entityProperties.localRotation,
            dimensions: entityProperties.dimensions,
            jointName: MyAvatar.jointNames[entityProperties.parentJointIndex],
            demoEntityID: entityID
        };

        replicaStoredTransforms[replica] = replicaStoredTransform;
        replicaList.push(replica);
    });

    _this.replicaCheckedOut = function(entityID, args) {
        var ARGS_INDEX = {
            REPLICA_OVERLAY: 0,
            NEW_ENTITY: 1
        };
        var replicaOverlayID = args[ARGS_INDEX.REPLICA_OVERLAY];
        var newEntityID = args[ARGS_INDEX.NEW_ENTITY];
        
        // Delete the new entity when the transforms are not found.
        if (replicaStoredTransforms[replicaOverlayID] === undefined) {
            print('Could not find transform data, deleting purchased entity.');
            Entities.deleteEntity(newEntityID);
            return;
        }

        var transform = replicaStoredTransforms[replicaOverlayID];
        var transformProperties = {
            parentID: MyAvatar.sessionUUID,
            parentJointIndex: MyAvatar.getJointIndex(transform.jointName),
            localPosition: transform.position,
            localRotation: transform.rotation,
            dimensions: transform.dimensions,
            velocity: {x: 0, y: 0, z: 0},
            dynamic: false
        };
        Entities.editEntity(newEntityID, transformProperties);

        var MAKING_SURE_INTERVAL = 100; // Milliseconds
        // Make really sure that the translations are set properly
        var makeSureInterval = Script.setInterval(function() {
            Entities.editEntity(newEntityID, transformProperties);
        }, MAKING_SURE_INTERVAL);

        // Five seconds should be enough to be sure, otherwise we have a problem
        var STOP_MAKING_SURE_TIMEOUT = 5000; // Milliseconds
        Script.setTimeout(function() {
            makeSureInterval.stop();
        }, STOP_MAKING_SURE_TIMEOUT);


        var newEntityProperties = Entities.getEntityProperties(newEntityID, ['marketplaceID', 'certificateID']);
        var certificateID = undefined;
        if (newEntityProperties.certificateID !== "" && newEntityProperties.certificateID !== undefined) {
            certificateID = newEntityProperties.certificateID;
        }
        addTransformForMarketplaceItem(newEntityProperties.marketplaceID, certificateID, transform);

        // Remove the demo object, to prevent overlapping objects
        Entities.deleteEntity(transform.demoEntityID);
    };
    var setupApp = (function() {
        button = TABLET.addButton({
            icon: APP_ICON,
            text: APP_NAME
        });
        HMD.openTablet(true);
        function onClicked() {
            TABLET.gotoWebScreen(APP_URL); 
        }
        button.clicked.connect(onClicked);
        TABLET.gotoWebScreen(APP_URL);
    });

    _this.enterEntity = (function(entityID) {
        setupApp();
        isInZone = true;
        left = true;
        getCheckoutStandPosition();
        SHARED.getAvatarChildEntities(MyAvatar).forEach(function (entityID) {
            var MAX_ITEMS = 10;
            if (replicaList.length < MAX_ITEMS){
                var childUserData = Entities.getEntityProperties(entityID, 'userData').userData;
                var isAttachment = childUserData.indexOf("attached\":true");
                var marketplaceID = Entities.getEntityProperties(entityID, 'marketplaceID').marketplaceID;
                if (marketplaceID && (isAttachment !== -1)) {
                
                    // TODO check for already purchased 
                    spawnOverlayReplica(entityID); // put a copy of the item on the table
                    // move spawn position over to the next empty spot
                    var moveRight = ITEM_OFFSET.x * ITEM_HEIGHT;
                    var moveBack = ITEM_OFFSET.z * ITEM_HEIGHT;
                    var moveDown = ITEM_OFFSET.y * ITEM_HEIGHT;
                    var moveLeft = ITEM_OFFSET.x * ITEM_HEIGHT;
                    var moveForward = ITEM_OFFSET.z * ITEM_HEIGHT;
                    if (left) {
                        spawnZ += moveRight;
                        spawnX += moveBack;
                        left = false;
                    } else {
                        spawnY -= moveDown;
                        spawnZ -= moveLeft;
                        spawnX -= moveForward;
                        left = true;
                    }
                }
            }
        });
        var tabletTransform = {
            parentID: tableID,
            localPosition: TABLET_LOCAL_POSITION_OFFSET,
            localRotation: Quat.fromVec3Degrees(TABLET_ROTATIONAL_OFFSET)
        };
        Overlays.editOverlay(HMD.tabletID, tabletTransform);
        var tabletTransformInterval = Script.setInterval(function() {
            // print(JSON.stringify(tabletTransform)); 
            Overlays.editOverlay(HMD.tabletID, tabletTransform);
        }, 100);
        Script.setTimeout(function() {
            tabletTransformInterval.stop();
        }, 1000);
    });
    
    _this.leaveEntity = function() {
        isInZone = false;
        var SCANNER_RANGE_METERS = 1000;
        Entities.findEntities(MyAvatar.position, SCANNER_RANGE_METERS).forEach(function(entity) {
            try {
                var name = Entities.getEntityProperties(entity).name;
                if (name.indexOf("Checkout Item") !== -1) {
                    Entities.deleteEntity(entity);
                }
            } catch (e) {
                print("Error cleaning up.");
            }
        }); 
        replicaList.forEach(function (overlayItem) {
            Overlays.deleteOverlay(overlayItem);
        });
        replicaList = [];
        replicaStoredTransforms = {};
        TABLET.removeButton(button);
        TABLET.gotoHomeScreen();
        Overlays.editOverlay(HMD.tabletID, {parentID: MyAvatar.sessionUUID});
        HMD.closeTablet();
    };

    _this.unload = function() {
        // sure you leave the entity if you're still in there
        if (isInZone) {
            _this.leaveEntity();
        }
    };
});

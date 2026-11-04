import { AssetType, defineAssets } from '@iwsdk/core';
import {
  createAtlasFloor,
  createAtlasPlatform,
  createBeacon,
  createCluster,
  createDepthDust,
  createNodeOrb,
  createStarfield,
} from './scene-assets/atlas.scene-asset.js';

function uikitml(fileName: string, name: string) {
  const filePath = `/ui/${fileName}`;
  return {
    url: `${import.meta.env.BASE_URL}${filePath.replace(/^\//, '')}`,
    type: AssetType.UIKitML,
    name,
  };
}

// Only assets referenced by the canonical scene are defined.
// Unused IWSDK starter assets were removed 2026-10-26 (overnight audit)
// to avoid eager construction of geometry/materials we never display.
export default defineAssets({
  'atlas-floor': createAtlasFloor(),
  'atlas-platform': createAtlasPlatform(),
  'atlas-cluster-teal': createCluster(101, '#2dd4bf', 1100, 2.8),
  'atlas-cluster-gold': createCluster(202, '#e8c56a', 1400, 3.4),
  'atlas-cluster-white': createCluster(303, '#dbeafe', 900, 2.3),
  'atlas-starfield': createStarfield(),
  'atlas-depth-dust': createDepthDust(),
  'atlas-node-orb': createNodeOrb(),
  'atlas-beacon': createBeacon(),
  'welcome-panel': uikitml('welcome.uikitml', 'Welcome Panel'),
});

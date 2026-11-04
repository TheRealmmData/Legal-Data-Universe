/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { EvidenceSystem } from './evidence-ui.js';
import { MixedRealitySystem } from './mixed-reality.js';
import { PanelSystem } from './panel.js';
import { ScaleSystem } from './scale.js';
import { BrowserControlsSystem } from './browser-controls.ts';

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world.registerSystem(PanelSystem);
  world.registerSystem(MixedRealitySystem);
  world.registerSystem(ScaleSystem);
  world.registerSystem(EvidenceSystem);
  world.registerSystem(BrowserControlsSystem);
});

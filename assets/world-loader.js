/* Loads the 3D world (Three.js, models and scene modules) without blocking the page.
 *
 * Why: the world is ~2.5 MB of script. As plain <script> tags at the end of <body>
 * it delayed DOMContentLoaded, so the menu, tabs and form stayed inert until every
 * model had downloaded. This file is included in <head>; it starts the downloads
 * immediately, in parallel with HTML parsing, and executes them in order
 * (async=false). site.js waits on MarioWorldLoader.load() before starting the scene.
 *
 * This list is the single place that names the world modules for every page.
 * The cache-busting version is taken from this file's own ?v= query, so bumping
 * the version in the HTML (tools/bump-version.sh) also bumps every module here.
 */
(function (root) {
  'use strict';
  var WORLD_SCRIPTS = [
    'three.min',
    'imported-models',
    'world-models',
    'world-geography',
    'story-world',
    'connected-map',
    'world-enrichment',
    'village-life',
    'frontier-scenes',
    'town-facilities',
    'island-landmarks',
    'ground-scatter',
    'render-quality',
    'map-weather',
    'world-environment',
    'planet3d'
  ];
  var self = document.currentScript;
  var src = self ? self.src : '';
  var version = /[?&]v=([^&#]+)/.exec(src);
  var suffix = version ? '?v=' + version[1] : '';
  var base = src ? src.replace(/[^/]*$/, '') : 'assets/';
  var promise = null;

  function load() {
    if (promise) return promise;
    promise = new Promise(function (resolve, reject) {
      var remaining = WORLD_SCRIPTS.length;
      WORLD_SCRIPTS.forEach(function (name) {
        var script = document.createElement('script');
        script.src = base + name + '.js' + suffix;
        script.async = false;
        script.onload = function () { if (--remaining === 0) resolve(); };
        script.onerror = function () {
          var error = new Error('缺少本地场景资源：' + name + '.js');
          error.code = 'WORLD_ASSET_MISSING';
          reject(error);
        };
        document.head.appendChild(script);
      });
    });
    return promise;
  }

  root.MarioWorldLoader = { load: load, scripts: WORLD_SCRIPTS.slice() };
  load();
})(window);

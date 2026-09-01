(function() {
	'use strict';

	var map = L.map('map', {
		zoomControl: false,
	}).setView([48, -3], 5);

	function escapeHtml(string) {
		return string
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;');
	}

	function renderValue(value) {
		if (typeof value === 'string') {
			return '\'' + escapeHtml(value) + '\'';
		} else {
			return JSON.stringify(value).replace(/,/g, ', ');
		}
	}

	L.TileLayer.include({
		getExampleJS: function() {
			var layerName = this._providerName.replace('.', '_');

			var url = this._exampleUrl || this._url;
			var options = L.extend({}, this._options, this._exampleAPIcodes || {});

			// replace {variant} in urls with the selected variant, since
			// keeping it in the options map doesn't make sense for one layer
			if (options.variant) {
				url = url.replace('{variant}', options.variant);
				delete options.variant;
			}

			var code = 'var ' + layerName + ' = L.tileLayer(\'' + url + '\', {\n';

			var first = true;
			for (var option in options) {
				if (first) {
					first = false;
				} else {
					code += ',\n';
				}
				code += '\t' + option + ': ' + renderValue(options[option]);
			}
			code += '\n});\n';

			return code;
		}
	});

	var isOverlay = function(providerName, layer) {
		if (layer.options.opacity && layer.options.opacity < 1) {
			return true;
		}
		var overlayPatterns = [
			'^(OpenWeatherMap|OpenSeaMap|OpenSnowMap)',
			'OpenMapSurfer.(Hybrid|AdminBounds|ContourLines|Hillshade|ElementsAtRisk)',
			'Stadia.StamenToner(Lines|Labels)',
			'Stadia.StamenTerrain(Lines|Labels)',
			'^JusticeMap',
			'OpenAIP',
			'OpenRailwayMap',
			'SafeCast',
			'WaymarkedTrails.(hiking|cycling|mtb|slopes|riding|skating)'
		];

		return providerName.match('(' + overlayPatterns.join('|') + ')') !== null;
	};

	// Ignore some providers in the preview
	var isIgnored = function(providerName) {
		if (providerName === 'ignored') {
			return true;
		}
		// reduce the number of layers previewed for some providers
		if (providerName.startsWith('HERE') || providerName.startsWith('OpenWeatherMap') || providerName.startsWith('MapBox') || providerName.startsWith('MapTiler')) {
			var whitelist = [
				// API threshold almost reached, disabling for now.
				// 'HERE.normalDay',
				'OpenWeatherMap.Clouds',
				'OpenWeatherMap.Pressure',
				'OpenWeatherMap.Wind'
			];
			return whitelist.indexOf(providerName) === -1;
		}
		return false;
	};

	// collect all layers available in the provider definition
	var baseLayers = {};
	var overlays = {};

	var addLayer = function(name) {
		if (isIgnored(name)) {
			return;
		}
		var layer = L.tileLayer.provider(name);
		if (isOverlay(name, layer)) {
			overlays[name] = layer;
		} else {
			baseLayers[name] = layer;
		}
	};
	L.tileLayer.provider.eachLayer(addLayer);

	// add minimap control to the map
	var layersControl = L.control.layers.minimap(baseLayers, overlays, {
		collapsed: false
	}).addTo(map);

	// Pass a filter in the hash tag to show only layers containing that string
	// for example: #filter=Open
	var filterLayersControl = function() {
		var hash = window.location.hash;
		var filterIndex = hash.indexOf('filter=');
		if (filterIndex !== -1) {
			var filterString = hash.substr(filterIndex + 7).trim();
			var visible = layersControl.filter(filterString);

			// enable first layer as actual layer.
			var first = Object.keys(visible)[0];
			if (first in baseLayers) {
				map.addLayer(baseLayers[first]);
				map.eachLayer(function(layer) {
					if (layer._providerName !== first) {
						map.removeLayer(layer);
					}
				});
				layersControl.filter(filterString);
			}
		}
	};
	L.DomEvent.on(window, 'hashchange', filterLayersControl);

	// Does not work if called immediately, so ugly hack to apply filter
	// at first page load
	setTimeout(filterLayersControl, 100);

	// add OpenStreetMap.Mapnik, or the first if it does not exist
	if (baseLayers['OpenStreetMap.Mapnik']) {
		baseLayers['OpenStreetMap.Mapnik'].addTo(map);
	} else {
		baseLayers[Object.keys(baseLayers)[0]].addTo(map);
	}

	// if a layer is selected and if it has bounds an the bounds are not in the
	// current view, move the map view to contain the bounds
	map.on('baselayerchange', function(e) {
		var layer = e.layer;
		if (!map.hasLayer(layer)) {
			return;
		}
		if (layer.options.minZoom > 1 && map.getZoom() > layer.options.minZoom) {
			map.setZoom(layer.options.minZoom);
		}
		if (!layer.options.bounds) {
			return;
		}
		var bounds = L.latLngBounds(layer.options.bounds);
		map.fitBounds(bounds, {
			paddingTopLeft: [0, 200],
			paddingBottomRight: [200, 0]
		});
	});

	// Add the TileLayer source code control to the map
	map.addControl(new (L.Control.extend({
		options: {
			position: 'topleft'
		},
		onAdd: function(map) {
			var container = L.DomUtil.get('info');
			L.DomEvent.disableClickPropagation(container);

			L.DomUtil.create('h4', null, container).innerHTML = 'Provider names for <code>leaflet-providers.js</code>';
			var providerNames = L.DomUtil.create('code', 'provider-names', container);

			L.DomUtil.create('h4', '', container).innerHTML = 'Plain JavaScript:';
			var pre = L.DomUtil.create('pre', null, container);
			var code = L.DomUtil.create('code', 'javascript', pre);

			var depsVectorHeading = L.DomUtil.create('h4', '', container);
			var depsVectorP = L.DomUtil.create('p', '', container);
			var depsVectorPre = L.DomUtil.create('pre', '', container);
			var depsVectorCode = L.DomUtil.create('code', '', depsVectorPre);
			depsVectorHeading.style.display = depsVectorP.style.display = depsVectorPre.style.display = 'none';

			var update = function(event) {
				code.innerHTML = '';

				var names = [];
				var depsVector = null;

				// loop over the layers in the map and add the JS
				for (var key in map._layers) {
					var layer = map._layers[key];
					if (!layer.getExampleJS) {
						continue;
					}

					// do not add the layer currently being removed
					if (event && event.type === 'layerremove' && layer === event.layer) {
						continue;
					}
					names.push(L.Util.template('<a href="#filter={name}">{name}</a>', {
						name: layer._providerName
					}));
					code.innerHTML += layer.getExampleJS();
					if (layer._depsVector) {
						depsVector = layer._depsVector;
					}
				}
				providerNames.innerHTML = names.join(', ');

				// Show / hide the extra dependencies warning section
				if (depsVector) {
					var depLinks = depsVector.map(function (d) {
						return '<a href="' + d.url + '" target="_blank">' + d.name + '</a>';
					}).join(' and ');
					depsVectorHeading.innerHTML = '⚠ Extra dependencies required';
					depsVectorP.innerHTML = 'This provider uses vector tiles and requires ' + depLinks + '.' +
						' Include these <strong>before</strong> <code>leaflet-providers.js</code>:';
					depsVectorCode.innerHTML =
						'&lt;link href="https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.css" rel="stylesheet" /&gt;\n' +
						'&lt;script src="https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.js"&gt;&lt;/script&gt;\n' +
						'&lt;script src="https://unpkg.com/@maplibre/maplibre-gl-leaflet/leaflet-maplibre-gl.js"&gt;&lt;/script&gt;';
					depsVectorHeading.style.display = depsVectorP.style.display = depsVectorPre.style.display = '';
				} else {
					depsVectorHeading.style.display = depsVectorP.style.display = depsVectorPre.style.display = 'none';
				}

				/* global hljs:true */
				hljs.highlightBlock(code);
			};

			map.on({
				layeradd: update,
				layerremove: update
			});
			update();

			return container;
		}
	}))());
}());

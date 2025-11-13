/* Lightweight local fallback for Leaflet to avoid CDN during development.
This is NOT the real Leaflet implementation.
It only stubs minimal APIs used in the page to prevent errors if Google Maps key is missing.
Replace with the official Leaflet dist for full functionality. */
(function(root){
  if (root.L) return; // don't override if real leaflet loaded
  function Map(el){ this._el = el; }
  Map.prototype.setView = function(){ return this; };
  function marker(){ return { addTo: function(){ return this; } }; }
  function polyline(){ return { addTo: function(){ return this; } }; }
  function tileLayer(){ return { addTo: function(){ return this; } }; }
  function latLngBounds(){ return {}; }
  root.L = {
    map: function(el){ return new Map(el); },
    marker: marker,
    polyline: polyline,
    tileLayer: tileLayer,
    latLngBounds: latLngBounds
  };
})(this);

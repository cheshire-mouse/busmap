/*
	Leaflet.innerlabel, a plugin that adds innerlabels to circle markers for Leaflet powered maps.
		based on Leaflet.innerlabel by Jacob Toye, Smartrak
		https://github.com/Leaflet/Leaflet.innerlabel

	$Revision$
	$Date$
	$HeadURL$

*/
(function (window, document, undefined) {

L.InnerLabel = L.Popup.extend({
	options: {
		autoPan: false,
		className: '',
		closePopupOnClick: false,
		noHide: false,
		//offset: new L.Point(12, -15), // 6 (width of the innerlabel triangle) + 6 (padding)
		offset: new L.Point(0, 0), 
		opacity: 1
	},

	onAdd: function (map) {
		this._map = map;

		this._pane = this._source instanceof L.Marker ? map._panes.markerPane : map._panes.popupPane;

		if (!this._container) {
			this._initLayout();
		}
		this._updateContent();

		var animFade = map.options.fadeAnimation;

		if (animFade) {
			L.DomUtil.setOpacity(this._container, 0);
		}
		this._pane.appendChild(this._container);

		map.on('viewreset', this._updatePosition, this);

		if (this._animated) {
			map.on('zoomanim', this._zoomAnimation, this);
		}

		if (L.Browser.touch && !this.options.noHide) {
			L.DomEvent.on(this._container, 'click', this.close, this);
		}

		this._update();

		this.setOpacity(this.options.opacity);
	},

	onRemove: function (map) {
		this._pane.removeChild(this._container);

		L.Util.falseFn(this._container.offsetWidth); // force reflow

		map.off({
			viewreset: this._updatePosition,
			zoomanim: this._zoomAnimation
		}, this);

		if (map.options.fadeAnimation) {
			L.DomUtil.setOpacity(this._container, 0);
		}

		this._map = null;
	},

	close: function () {
		var map = this._map;
		if (L.Browser.touch && !this.options.noHide) {
			L.DomEvent.off(this._container, 'click', this.close);
		}

		if (map) {
			map._innerlabel = null;

			map.removeLayer(this);
		}
	},

	updateZIndex: function (zIndex) {
		this._zIndex = zIndex;

		if (this._container && this._zIndex) {
			this._container.style.zIndex = zIndex;
		}
	},

	setOpacity: function (opacity) {
		this.options.opacity = opacity;

		if (this._container) {
			L.DomUtil.setOpacity(this._container, opacity);
		}
	},

	_initLayout: function () {
		this._container = L.DomUtil.create('div', 'leaflet-innerlabel ' + this.options.className + ' leaflet-zoom-animated');
		this.updateZIndex(this._zIndex);
	},

	_updateContent: function () {
		if (!this._content) { return; }

		if (typeof this._content === 'string') {
			this._container.innerHTML = this._content;
		}
	},

	_updateLayout: function () {
		// Do nothing
	},

	_updatePosition: function () {
		var pos = this._map.latLngToLayerPoint(this._latlng);

		this._setPosition(pos);
	},

	_setPosition: function (pos) {
		//console.debug("_setPostition "+this._container.offsetWidth+" "+this._container.offsetHeight);
		var centeroffset=[0-this._container.offsetWidth/2,0-this._container.offsetHeight/2];
		//centeroffset=[0,0];
		pos = pos.add(this.options.offset).add(centeroffset);;

		L.DomUtil.setPosition(this._container, pos);
	},

	_zoomAnimation: function (opt) {
		var pos = this._map._latLngToNewLayerPoint(this._latlng, opt.zoom, opt.center);

		this._setPosition(pos);
	}
});

L.CircleMarker.include({
	bindInnerLabel: function (content, options) {
		if (!this._innerlabel || this._innerlabel.options !== options) {
			this._innerlabel = new L.InnerLabel(options, this);
		}

		this._innerlabel.setContent(content);

		if (!this._showInnerLabelAdded) {
			this.showInnerLabel();
			this._showInnerLabelAdded = true;
		}

		return this;
	},

	unbindInnerLabel: function () {
		if (this._innerlabel) {
			this.hideInnerLabel();
			this._innerlabel = null;
			this._showInnerLabelAdded = false;
		}
		return this;
	},

	updateInnerLabelContent: function (content) {
		if (this._innerlabel) {
			this._innerlabel.setContent(content);
		}
	},

	showInnerLabel: function () {
		this._innerlabel.setLatLng(this._latlng);
		this._map.showInnerLabel(this._innerlabel);
	},
		   
	hideInnerLabel: function () {
		this._innerlabel.close();
	}
		    
});

L.Map.include({
	showInnerLabel: function (innerlabel) {
		this._innerlabel = innerlabel;

		return this.addLayer(innerlabel);
	}
});

}(this, document));

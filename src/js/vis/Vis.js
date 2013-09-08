vde.Vis = (function() {
  var vis = {
    properties: {
      width: 500,
      height: 375,
      _autopad: true,
      // padding: {top:30, left:40, right:30, bottom:40}
    },

    _data:   {},
    pipelines: {},
    groups: {},
    groupOrder: [],

    view: null,
    evtHandlers: {}
  };

  vis.data = function(name, data, type) {
    if(!data) return vis._data[name];

    if(vg.isObject(data)) {
      vis._data[name] = {
        name: name,
        values: data
      };
    }

    if(vg.isString(data)) {
      vis._data[name] = {
        name: name,
        url: data,
        format: vg.isString(type) ? {type: type} : type
      };

      var dataModel = vg.parse.data([vis._data[name]], function() {
        vis._data[name].values = dataModel.load[name];
      });
    }
  };

  vis.addEventListener = function(type, caller, handler) {
    vis.evtHandlers[type] || (vis.evtHandlers[type] = []);
    vis.evtHandlers[type].push({
      caller: caller,
      handler: handler
    });
  };

  vis.removeEventListener = function(type, caller) {
    var del = [], regd = (vis.evtHandlers[type] || []);
    regd.forEach(function(r, i) {
      if(r.caller == caller) del.push(i);
    });

    del.forEach(function(d) { regd.splice(d, 1); })
  };

  vis.parse = function(inlinedValues) {
    var props = vis.properties;
    var spec = {
      width: props.width,
      height: props.height,
      padding: props._autopad ? 'auto' : props.padding,
      data: [],
      scales: [],
      marks: []
    };

    vde.Vis.callback.run('vis.pre_spec', this, {spec: spec});

    inlinedValues = (inlinedValues == null || inlinedValues == true);
    for(var d in vis._data) {
      var dd = vg.duplicate(vis._data[d]);
      if(dd.url)        // Inline values to deal with x-site restrictions
        delete dd[inlinedValues ? 'url' : 'values'];

      spec.data.push(dd);
    };

    // Scales are defined within groups. No global scales.
    for(var p in vis.pipelines) {
      var pl = vis.pipelines[p];
      // Clear scales hasAxis flag.
      for(var s in pl.scales) {
        pl.scales[s].hasAxis = false;
        pl.scales[s].used = false;
      }
      spec.data = spec.data.concat(pl.spec());
    }

    // Reverse order of groups: earlier in groupOrder => closer to front
    vis.groupOrder.forEach(function(g) { spec.marks.unshift(vis.groups[g].spec()); });

    vde.Vis.callback.run('vis.post_spec', this, {spec: spec});

    // Now that the spec has been generated, bookkeep to clean up unused scales
    for(var p in vis.pipelines) vis.pipelines[p].bookkeep();
    for(var g in vis.groups) vis.groups[g].bookkeep();

    vg.parse.spec(spec, function(chart) {
      d3.select('#vis').selectAll('*').remove();
      (vde.Vis.view = chart({ el: '#vis' })).update();

      for(var g in vis.groups) vis.groups[g].annotate();

      for(var type in vis.evtHandlers)
        vis.evtHandlers[type].forEach(function(h, i) {
          if(type.indexOf('key') != -1) d3.select('body').on(type + '.' + i, h.handler);
          else vde.Vis.view.on(type, h.handler);
        });

      var newMark = function() {
        if(!vde.iVis.dragging || !vde.iVis.newMark) return;
        vde.iVis.addMark();
      };

      vde.Vis.view
        .on('mousedown', function(e, i) {
          if(!vde.iVis.dragging) vde.iVis.dragging = {item: i, prev: [e.pageX, e.pageY]};
        })
        .on('mouseup', function() { newMark(); vde.iVis.dragging = null; })
        .on('mouseover', function(e, i) {
          var d = vde.iVis.dragging, m = i.mark.def.vdeMdl;
          if(!d || !$(d).html() || !m) return;
          if(m == vde.iVis.activeMark && vde.iVis.activeItem == i.vdeKey) return;
          if(m.type == 'group') return;

          vde.iVis.markTimeout = window.setTimeout(function() {
            var scope = vde.iVis.ngScope();
            scope.$apply(function() { scope.toggleVisual(m, i.vdeKey || i.key || 0); });

            if($(d).hasClass('mark')) m.connectionTargets();
            else m.propertyTargets();
          }, vde.iVis.timeout);
        })
        .on('mouseout', function() { window.clearTimeout(vde.iVis.markTimeout); });

      d3.select('#vis canvas').on('mouseup.vis', newMark);

      // Prevent backspace from navigating back and instead delete
      d3.select('body').on('keydown.vis', function() {
        var m = vde.iVis.activeMark, evt = d3.event;
        if(!m || m.type != 'group') return;

        var preventBack = false;
        if (evt.keyCode == 8) {
            var d = evt.srcElement || evt.target;
            if (d.tagName.toUpperCase() === 'INPUT' || d.tagName.toUpperCase() === 'TEXTAREA' || d.contentEditable) {
                preventBack = d.readOnly || d.disabled;
            }
            else preventBack = true;
        }

        if (preventBack) {
          evt.preventDefault();
          vde.iVis.ngScope().removeVisual('marks', m.name);
        }
      });

      // If the vis gets reparsed, reparse the interactive layer too to update any
      // visible handlers, etc.
      vde.iVis.parse();
    });

    return spec;
  };

  vis.export = function() {
    var ex = {
      groups: {},
      pipelines: vg.duplicate(vis.pipelines)
    };

    for(var g in vis.groups) ex.groups[g] = vg.duplicate(vis.groups[g].export());
    return ex;
  };

  vis.parseProperty = function(props, prop) {
    var p = props[prop], parsed = {};
    if(!vg.isObject(p)) return;
    if(p.disabled) return;

    for(var k in p) {
      if(p[k] == undefined) return;

      if(k == 'scale') { parsed[k] = p[k].name; p[k].used = true; }
      else if(k == 'field') parsed[k] = p[k].spec();
      else {
        var value = (!isNaN(+p[k])) ? +p[k] : p[k];
        if(value == 'auto') {   // If the value is auto, rangeband
          if(p.scale.type() == 'ordinal') {
            parsed.band = true;
            parsed.offset = -1;
          } else parsed[k] = 0; // If we don't have an ordinal scale, just set value:0
        } else {
          parsed[k] = value;
        }
      }
    };

    return parsed;
  };

  return vis;
})();

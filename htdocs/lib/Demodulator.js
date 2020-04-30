function Filter() {
    this.min_passband = 100;
}

Filter.prototype.getLimits = function() {
    var max_bw;
    if (secondary_demod === 'pocsag') {
        max_bw = 12500;
    } else {
        max_bw = (audioEngine.getOutputRate() / 2) - 1;
    }
    return {
        high: max_bw,
        low: -max_bw
    };
};

function Envelope(parent) {
    this.parent = parent;
    this.dragged_range = Demodulator.draggable_ranges.none;
}

Envelope.prototype.draw = function(visible_range){
    this.visible_range = visible_range;
    this.drag_ranges = this.envelope_draw(
        range,
        center_freq + this.parent.offset_frequency + this.parent.low_cut,
        center_freq + this.parent.offset_frequency + this.parent.high_cut,
        this.color, center_freq + this.parent.offset_frequency
    );
};

Envelope.prototype.envelope_draw = function (range, from, to, color, line) {
    //                                               ____
    // Draws a standard filter envelope like this: _/    \_
    // Parameters are given in offset frequency (Hz).
    // Envelope is drawn on the scale canvas.
    // A "drag range" object is returned, containing information about the draggable areas of the envelope
    // (beginning, ending and the line showing the offset frequency).
    if (typeof color === "undefined") color = "#ffff00"; //yellow
    var env_bounding_line_w = 5;   //
    var env_att_w = 5;             //     _______   ___env_h2 in px   ___|_____
    var env_h1 = 17;               //   _/|      \_ ___env_h1 in px _/   |_    \_
    var env_h2 = 5;                //   |||env_att_line_w                |_env_lineplus
    var env_lineplus = 1;          //   ||env_bounding_line_w
    var env_line_click_area = 6;
    //range=get_visible_freq_range();
    var from_px = scale_px_from_freq(from, range);
    var to_px = scale_px_from_freq(to, range);
    if (to_px < from_px) /* swap'em */ {
        var temp_px = to_px;
        to_px = from_px;
        from_px = temp_px;
    }

    /*from_px-=env_bounding_line_w/2;
    to_px+=env_bounding_line_w/2;*/
    from_px -= (env_att_w + env_bounding_line_w);
    to_px += (env_att_w + env_bounding_line_w);
    // do drawing:
    scale_ctx.lineWidth = 3;
    scale_ctx.strokeStyle = color;
    scale_ctx.fillStyle = color;
    var drag_ranges = {envelope_on_screen: false, line_on_screen: false};
    if (!(to_px < 0 || from_px > window.innerWidth)) // out of screen?
    {
        drag_ranges.beginning = {x1: from_px, x2: from_px + env_bounding_line_w + env_att_w};
        drag_ranges.ending = {x1: to_px - env_bounding_line_w - env_att_w, x2: to_px};
        drag_ranges.whole_envelope = {x1: from_px, x2: to_px};
        drag_ranges.envelope_on_screen = true;
        scale_ctx.beginPath();
        scale_ctx.moveTo(from_px, env_h1);
        scale_ctx.lineTo(from_px + env_bounding_line_w, env_h1);
        scale_ctx.lineTo(from_px + env_bounding_line_w + env_att_w, env_h2);
        scale_ctx.lineTo(to_px - env_bounding_line_w - env_att_w, env_h2);
        scale_ctx.lineTo(to_px - env_bounding_line_w, env_h1);
        scale_ctx.lineTo(to_px, env_h1);
        scale_ctx.globalAlpha = 0.3;
        scale_ctx.fill();
        scale_ctx.globalAlpha = 1;
        scale_ctx.stroke();
    }
    if (typeof line !== "undefined") // out of screen?
    {
        var line_px = scale_px_from_freq(line, range);
        if (!(line_px < 0 || line_px > window.innerWidth)) {
            drag_ranges.line = {x1: line_px - env_line_click_area / 2, x2: line_px + env_line_click_area / 2};
            drag_ranges.line_on_screen = true;
            scale_ctx.moveTo(line_px, env_h1 + env_lineplus);
            scale_ctx.lineTo(line_px, env_h2 - env_lineplus);
            scale_ctx.stroke();
        }
    }
    return drag_ranges;
};

Envelope.prototype.drag_start = function(x, key_modifiers){
    this.key_modifiers = key_modifiers;
    this.dragged_range = this.where_clicked(x, this.drag_ranges, key_modifiers);
    this.drag_origin = {
        x: x,
        low_cut: this.parent.low_cut,
        high_cut: this.parent.high_cut,
        offset_frequency: this.parent.offset_frequency
    };
    return this.dragged_range !== Demodulator.draggable_ranges.none;
};

Envelope.prototype.where_clicked = function(x, drag_ranges, key_modifiers) {  // Check exactly what the user has clicked based on ranges returned by envelope_draw().
    var in_range = function (x, range) {
        return range.x1 <= x && range.x2 >= x;
    };
    var dr = Demodulator.draggable_ranges;

    if (key_modifiers.shiftKey) {
        //Check first: shift + center drag emulates BFO knob
        if (drag_ranges.line_on_screen && in_range(x, drag_ranges.line)) return dr.bfo;
        //Check second: shift + envelope drag emulates PBF knob
        if (drag_ranges.envelope_on_screen && in_range(x, drag_ranges.whole_envelope)) return dr.pbs;
    }
    if (drag_ranges.envelope_on_screen) {
        // For low and high cut:
        if (in_range(x, drag_ranges.beginning)) return dr.beginning;
        if (in_range(x, drag_ranges.ending)) return dr.ending;
        // Last priority: having clicked anything else on the envelope, without holding the shift key
        if (in_range(x, drag_ranges.whole_envelope)) return dr.anything_else;
    }
    return dr.none; //User doesn't drag the envelope for this demodulator
};


Envelope.prototype.drag_move = function(x) {
    var dr = Demodulator.draggable_ranges;
    var new_value;
    if (this.dragged_range === dr.none) return false; // we return if user is not dragging (us) at all
    var freq_change = Math.round(this.visible_range.hps * (x - this.drag_origin.x));

    //dragging the line in the middle of the filter envelope while holding Shift does emulate
    //the BFO knob on radio equipment: moving offset frequency, while passband remains unchanged
    //Filter passband moves in the opposite direction than dragged, hence the minus below.
    var minus = (this.dragged_range === dr.bfo) ? -1 : 1;
    //dragging any other parts of the filter envelope while holding Shift does emulate the PBS knob
    //(PassBand Shift) on radio equipment: PBS does move the whole passband without moving the offset
    //frequency.
    if (this.dragged_range === dr.beginning || this.dragged_range === dr.bfo || this.dragged_range === dr.pbs) {
        //we don't let low_cut go beyond its limits
        if ((new_value = this.drag_origin.low_cut + minus * freq_change) < this.parent.filter.getLimits().low) return true;
        //nor the filter passband be too small
        if (this.parent.high_cut - new_value < this.parent.filter.min_passband) return true;
        //sanity check to prevent GNU Radio "firdes check failed: fa <= fb"
        if (new_value >= this.parent.high_cut) return true;
        this.parent.low_cut = new_value;
    }
    if (this.dragged_range === dr.ending || this.dragged_range === dr.bfo || this.dragged_range === dr.pbs) {
        //we don't let high_cut go beyond its limits
        if ((new_value = this.drag_origin.high_cut + minus * freq_change) > this.parent.filter.getLimits().high) return true;
        //nor the filter passband be too small
        if (new_value - this.parent.low_cut < this.parent.filter.min_passband) return true;
        //sanity check to prevent GNU Radio "firdes check failed: fa <= fb"
        if (new_value <= this.parent.low_cut) return true;
        this.parent.high_cut = new_value;
    }
    if (this.dragged_range === dr.anything_else || this.dragged_range === dr.bfo) {
        //when any other part of the envelope is dragged, the offset frequency is changed (whole passband also moves with it)
        new_value = this.drag_origin.offset_frequency + freq_change;
        if (new_value > bandwidth / 2 || new_value < -bandwidth / 2) return true; //we don't allow tuning above Nyquist frequency :-)
        this.parent.offset_frequency = new_value;
    }
    //now do the actual modifications:
    mkenvelopes(this.visible_range);
    this.parent.set();
    //will have to change this when changing to multi-demodulator mode:
    tunedFrequencyDisplay.setFrequency(center_freq + this.parent.offset_frequency);
    return true;
};

Envelope.prototype.drag_end = function(){
    demodulator_buttons_update();
    var to_return = this.dragged_range !== Demodulator.draggable_ranges.none; //this part is required for cliking anywhere on the scale to set offset
    this.dragged_range = Demodulator.draggable_ranges.none;
    return to_return;
};


//******* class Demodulator_default_analog *******
// This can be used as a base for basic audio demodulators.
// It already supports most basic modulations used for ham radio and commercial services: AM/FM/LSB/USB

function Demodulator(offset_frequency, modulation) {
    this.offset_frequency = offset_frequency;
    this.envelope = new Envelope(this);
    this.color = Demodulator.get_next_color();
    this.modulation = modulation;
    this.filter = new Filter();
    this.squelch_level = -150;
    this.dmr_filter = 3;
    this.state = {};
    this.secondary_demod = false;
    var mode = Modes.findByModulation(modulation);
    if (mode) {
        this.low_cut = mode.bandpass.low_cut;
        this.high_cut = mode.bandpass.high_cut;
    }
}

//ranges on filter envelope that can be dragged:
Demodulator.draggable_ranges = {
    none: 0,
    beginning: 1 /*from*/,
    ending: 2 /*to*/,
    anything_else: 3,
    bfo: 4 /*line (while holding shift)*/,
    pbs: 5
}; //to which parameter these correspond in envelope_draw()

Demodulator.color_index = 0;
Demodulator.colors = ["#ffff00", "#00ff00", "#00ffff", "#058cff", "#ff9600", "#a1ff39", "#ff4e39", "#ff5dbd"];

Demodulator.get_next_color = function() {
    if (this.color_index >= this.colors.length) this.color_index = 0;
    return (this.colors[this.color_index++]);
}



Demodulator.prototype.set_offset_frequency = function(to_what) {
    if (to_what > bandwidth / 2 || to_what < -bandwidth / 2) return;
    this.offset_frequency = Math.round(to_what);
    this.set();
    mkenvelopes(get_visible_freq_range());
    tunedFrequencyDisplay.setFrequency(center_freq + to_what);
    updateHash();
};

Demodulator.prototype.get_offset_frequency = function() {
    return this.offset_frequency;
};

Demodulator.prototype.get_modulation = function() {
    return this.modulation;
};

Demodulator.prototype.start = function() {
    this.set();
    ws.send(JSON.stringify({
        "type": "dspcontrol",
        "action": "start"
    }));
};

// TODO check if this is actually used
Demodulator.prototype.stop = function() {
};

Demodulator.prototype.send = function(params) {
    ws.send(JSON.stringify({"type": "dspcontrol", "params": params}));
}

Demodulator.prototype.set = function () {  //this function sends demodulator parameters to the server
    var params = {
        "low_cut": this.low_cut,
        "high_cut": this.high_cut,
        "offset_freq": this.offset_frequency,
        "mod": this.modulation,
        "dmr_filter": this.dmr_filter,
        "squelch_level": this.squelch_level,
        "secondary_mod": this.secondary_demod,
        "secondary_offset_freq": this.secondary_offset_freq
    };
    var to_send = {};
    for (var key in params) {
        if (!(key in this.state) || params[key] !== this.state[key]) {
            to_send[key] = params[key];
        }
    }
    if (Object.keys(to_send).length > 0) {
        this.send(to_send);
        for (var key in to_send) {
            this.state[key] = to_send[key];
        }
    }
    mkenvelopes(get_visible_freq_range());
};

Demodulator.prototype.setSquelch = function(squelch) {
    this.squelch_level = squelch;
    this.set();
};

Demodulator.prototype.setDmrFilter = function(dmr_filter) {
    this.dmr_filter = dmr_filter;
    this.set();
};

Demodulator.prototype.setBandpass = function(bandpass) {
    this.bandpass = bandpass;
    this.low_cut = bandpass.low_cut;
    this.high_cut = bandpass.high_cut;
    this.set();
};

Demodulator.prototype.getBandpass = function() {
    return {
        low_cut: this.low_cut,
        high_cut: this.high_cut
    };
};

Demodulator.prototype.set_secondary_demod = function(secondary_demod) {
    this.secondary_demod = secondary_demod;
    this.set();
};

Demodulator.prototype.set_secondary_offset_freq = function(secondary_offset) {
    this.secondary_offset_freq = secondary_offset;
    this.set();
};

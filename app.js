(function () {
  "use strict";

  var SAMPLE_RATE = 44100;
  var ATTACK_MS = 5;
  var RELEASE_MS = 3;

  var audioCtx = null;
  var activeOscillators = [];
  var sequence = [];
  var currentWaveformData = null;
  var progressAnimId = null;
  var progressStartTime = 0;
  var progressDuration = 0;

  var liveAnimId = null;
  var liveFpsCounter = 0;
  var liveFpsDisplay = 0;
  var liveFpsTimer = 0;
  var livePaused = false;
  var liveTargetFps = 120;
  var liveFrameInterval = 1000 / 120;
  var liveLastFrameTime = 0;
  var liveSmooth = false;
  var liveCycleTime = 0;
  var liveCycleSamples = null;
  var liveCycleTotalMs = 0;
  var liveCycleParams = null;

  var PRESETS = [
    { name: "garmin_beep", label: "基础提示", pattern: [{ freq: 800, duration: 80, gap: 30 }, { freq: 4200, duration: 150, gap: 0 }] },
    { name: "garmin_alert", label: "警报音", pattern: [{ freq: 800, duration: 100, gap: 80 }, { freq: 4200, duration: 200, gap: 150 }, { freq: 800, duration: 100, gap: 80 }, { freq: 4200, duration: 200, gap: 0 }] },
    { name: "garmin_start", label: "开始提示", pattern: [{ freq: 1200, duration: 80, gap: 30 }, { freq: 1200, duration: 80, gap: 30 }, { freq: 4000, duration: 200, gap: 0 }] },
    { name: "garmin_lap", label: "计圈提示", pattern: [{ freq: 1000, duration: 100, gap: 200 }, { freq: 4000, duration: 100, gap: 0 }] },
    { name: "double_beep", label: "双响提示", pattern: [{ freq: 3000, duration: 150, gap: 100 }, { freq: 3000, duration: 150, gap: 0 }] },
    { name: "triple_beep", label: "三响提示", pattern: [{ freq: 3500, duration: 120, gap: 80 }, { freq: 3500, duration: 120, gap: 80 }, { freq: 3500, duration: 120, gap: 0 }] },
    { name: "rising", label: "递增音阶", pattern: [{ freq: 1000, duration: 100, gap: 50 }, { freq: 2000, duration: 100, gap: 50 }, { freq: 3000, duration: 100, gap: 50 }, { freq: 4000, duration: 150, gap: 0 }] },
    { name: "falling", label: "递减音阶", pattern: [{ freq: 4000, duration: 150, gap: 50 }, { freq: 3000, duration: 100, gap: 50 }, { freq: 2000, duration: 100, gap: 50 }, { freq: 1000, duration: 100, gap: 0 }] },
    { name: "sos", label: "SOS 摩尔斯", pattern: [{ freq: 2400, duration: 100, gap: 80 }, { freq: 2400, duration: 100, gap: 80 }, { freq: 2400, duration: 100, gap: 200 }, { freq: 2400, duration: 300, gap: 80 }, { freq: 2400, duration: 300, gap: 80 }, { freq: 2400, duration: 300, gap: 200 }, { freq: 2400, duration: 100, gap: 80 }, { freq: 2400, duration: 100, gap: 80 }, { freq: 2400, duration: 100, gap: 0 }] },
  ];

  PRESETS.forEach(function (p) {
    p.totalDuration = p.pattern.reduce(function (s, e) { return s + e.duration + (e.gap || 0); }, 0);
  });

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return document.querySelectorAll(sel); }

  var freqSlider = $("#freq");
  var freqNum = $("#freqNum");
  var freqVal = $("#freqVal");
  var durSlider = $("#duration");
  var durNum = $("#durationNum");
  var durVal = $("#durVal");
  var gapSlider = $("#gap");
  var gapNum = $("#gapNum");
  var gapVal = $("#gapVal");
  var volSlider = $("#volume");
  var volNum = $("#volumeNum");
  var volVal = $("#volVal");
  var waveSelect = $("#waveType");
  var waveformCanvas = $("#waveformCanvas");
  var waveformProgress = $("#waveformProgress");
  var liveWaveCanvas = $("#liveWaveCanvas");
  var liveWaveOverlay = $("#liveWaveOverlay");
  var liveWaveState = $("#liveWaveState");
  var liveWaveParams = $("#liveWaveParams");
  var btnLivePause = $("#btnLivePause");
  var pauseIcon = $("#pauseIcon");
  var pauseLabel = $("#pauseLabel");
  var liveFpsSelect = $("#liveFpsSelect");
  var lwpFreq = $("#lwpFreq");
  var lwpWave = $("#lwpWave");
  var lwpVol = $("#lwpVol");
  var lwpDur = $("#lwpDur");
  var lwpGap = $("#lwpGap");
  var lwpFps = $("#lwpFps");
  var btnLiveSmooth = $("#btnLiveSmooth");
  var smoothLabel = $("#smoothLabel");

  function getFreq() { return parseInt(freqSlider.value) || 4000; }
  function getDuration() { return parseInt(durSlider.value) || 200; }
  function getGap() { return parseInt(gapSlider.value) || 50; }
  function getVolume() { return Math.max(1, parseInt(volSlider.value) || 80) / 100; }
  function getWave() { return waveSelect.value; }

  function syncSlider(slider, numInput, displayEl, suffix) {
    var updateNum = function () {
      numInput.value = slider.value;
      if (displayEl) displayEl.textContent = slider.value + (suffix || "");
    };
    var updateSlider = function () {
      var v = parseInt(numInput.value);
      if (isNaN(v)) v = parseInt(slider.min) || 0;
      v = Math.max(parseInt(slider.min), Math.min(parseInt(slider.max), v));
      numInput.value = v;
      slider.value = v;
      if (displayEl) displayEl.textContent = v + (suffix || "");
    };
    slider.addEventListener("input", updateNum);
    numInput.addEventListener("change", updateSlider);
    numInput.addEventListener("blur", updateSlider);
  }

  syncSlider(freqSlider, freqNum, freqVal, " Hz");
  syncSlider(durSlider, durNum, durVal, " ms");
  syncSlider(gapSlider, gapNum, gapVal, " ms");
  syncSlider(volSlider, volNum, volVal, " %");

  function getAudioContext() {
    if (!audioCtx || audioCtx.state === "closed") {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        return null;
      }
    }
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume().catch(function () { });
    }
    return audioCtx;
  }

  function mapWaveToWebAudio(wave) {
    var map = { sine: "sine", square: "square", sawtooth: "sawtooth", triangle: "triangle" };
    return map[wave] || "square";
  }

  function mapWaveLabel(wave) {
    var map = { sine: "正弦波", square: "方波", sawtooth: "锯齿波", triangle: "三角波" };
    return map[wave] || "方波";
  }

  function stopProgress() {
    if (progressAnimId) { cancelAnimationFrame(progressAnimId); progressAnimId = null; }
    waveformProgress.classList.remove("visible");
  }

  function startProgress(durationMs) {
    stopProgress();
    progressStartTime = performance.now();
    progressDuration = durationMs;
    waveformProgress.classList.add("visible");
    waveformProgress.style.left = "0%";
    animateProgress();
  }

  function animateProgress() {
    var elapsed = performance.now() - progressStartTime;
    var pct = Math.min(100, (elapsed / progressDuration) * 100);
    waveformProgress.style.left = pct + "%";
    if (elapsed < progressDuration) {
      progressAnimId = requestAnimationFrame(animateProgress);
    } else {
      stopProgress();
    }
  }

  function stopAllAudio() {
    for (var i = activeOscillators.length - 1; i >= 0; i--) {
      try {
        activeOscillators[i].stop();
        activeOscillators[i].disconnect();
      } catch (e) { }
    }
    activeOscillators = [];
    stopProgress();
  }

  function playTone(ctx, freq, duration, waveType, volume, startTime) {
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = mapWaveToWebAudio(waveType);
    osc.frequency.setValueAtTime(freq, startTime);

    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(volume * 0.8, startTime + 0.003);
    gain.gain.setValueAtTime(volume * 0.8, startTime + duration - 0.003);
    gain.gain.linearRampToValueAtTime(0, startTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.01);

    activeOscillators.push(osc);
    osc.onended = function () {
      var idx = activeOscillators.indexOf(osc);
      if (idx !== -1) activeOscillators.splice(idx, 1);
    };
  }

  function playPreview(freq, durationMs, waveType, volume) {
    stopAllAudio();
    var ctx = getAudioContext();
    if (!ctx) { setLiveError("音频上下文不可用"); return; }
    var now = ctx.currentTime;
    var vol = volume != null ? volume : getVolume();
    var dur = (durationMs || getDuration()) / 1000;

    playTone(ctx, freq || getFreq(), dur, waveType || getWave(), vol, now);
    startProgress(durationMs || getDuration());
  }

  function playSequence() {
    if (sequence.length === 0) return;
    stopAllAudio();
    var ctx = getAudioContext();
    if (!ctx) { setLiveError("音频上下文不可用"); return; }
    var now = ctx.currentTime;
    var globalVol = getVolume();
    var t = now;
    var totalDur = 0;

    for (var i = 0; i < sequence.length; i++) {
      var item = sequence[i];
      var dur = item.duration / 1000;
      var vol = (item.volume != null ? item.volume : globalVol);
      if (item.freq > 0) {
        playTone(ctx, item.freq, dur, item.wave || "square", vol, t);
      }
      t += dur + (item.gap || 0) / 1000;
      totalDur += item.duration + (item.gap || 0);
    }

    startProgress(totalDur);
  }

  function sampleWave(wave, phase) {
    switch (wave) {
      case "sine": return Math.sin(2 * Math.PI * phase);
      case "square": return Math.sin(2 * Math.PI * phase) >= 0 ? 1 : -1;
      case "sawtooth": return 2 * (phase - Math.floor(phase + 0.5));
      case "triangle": return 2 * Math.abs(2 * (phase - Math.floor(phase + 0.5))) - 1;
      default: return Math.sin(2 * Math.PI * phase);
    }
  }

  function generateSamples(freq, durationMs, wave, volume) {
    var totalSamples = Math.ceil(durationMs / 1000 * SAMPLE_RATE);
    var samples = new Float32Array(totalSamples);
    var attackSamples = Math.ceil(ATTACK_MS / 1000 * SAMPLE_RATE);
    var releaseSamples = Math.ceil(RELEASE_MS / 1000 * SAMPLE_RATE);
    var sustainStart = attackSamples;
    var sustainEnd = totalSamples - releaseSamples;
    if (sustainEnd < sustainStart) { sustainEnd = sustainStart = Math.floor(totalSamples / 2); }

    for (var i = 0; i < totalSamples; i++) {
      var phase = (freq * i) / SAMPLE_RATE;
      var v = sampleWave(wave, phase);
      var env = 1;
      if (i < attackSamples) {
        env = i / attackSamples;
      } else if (i >= sustainEnd) {
        env = Math.max(0, (totalSamples - i) / releaseSamples);
      }
      samples[i] = v * env * volume;
    }
    return samples;
  }

  function generateSilence(durationMs) {
    var len = Math.ceil(durationMs / 1000 * SAMPLE_RATE);
    return new Float32Array(len);
  }

  function generatePatternSamples(pattern, volume) {
    var parts = [];
    var globalVol = volume;
    for (var i = 0; i < pattern.length; i++) {
      var item = pattern[i];
      var vol = (item.volume != null ? item.volume : globalVol);
      if (item.freq > 0) {
        parts.push(generateSamples(item.freq, item.duration, item.wave || "square", vol));
      }
      if ((item.gap || 0) > 0) {
        parts.push(generateSilence(item.gap));
      }
    }
    var total = parts.reduce(function (s, a) { return s + a.length; }, 0);
    var result = new Float32Array(total);
    var offset = 0;
    for (var j = 0; j < parts.length; j++) {
      result.set(parts[j], offset);
      offset += parts[j].length;
    }
    return result;
  }

  function encodeWav(samples) {
    var numChannels = 1;
    var bitsPerSample = 16;
    var byteRate = SAMPLE_RATE * numChannels * bitsPerSample / 8;
    var blockAlign = numChannels * bitsPerSample / 8;
    var dataSize = samples.length * blockAlign;
    var buffer = new ArrayBuffer(44 + dataSize);
    var view = new DataView(buffer);

    function writeStr(offset, str) {
      for (var i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    }

    writeStr(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, SAMPLE_RATE, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeStr(36, "data");
    view.setUint32(40, dataSize, true);

    for (var i = 0; i < samples.length; i++) {
      var s = Math.max(-1, Math.min(1, samples[i]));
      s = s < 0 ? s * 0x8000 : s * 0x7FFF;
      view.setInt16(44 + i * 2, s, true);
    }

    return buffer;
  }

  function downsampleForDisplay(samples, maxPoints) {
    if (samples.length <= maxPoints) return Array.from(samples);
    var step = Math.max(1, Math.floor(samples.length / maxPoints));
    var result = [];
    for (var i = 0; i < samples.length; i += step) {
      var chunkMin = 1, chunkMax = -1;
      for (var j = i; j < Math.min(i + step, samples.length); j++) {
        if (samples[j] < chunkMin) chunkMin = samples[j];
        if (samples[j] > chunkMax) chunkMax = samples[j];
      }
      result.push(Math.abs(chunkMax - 0) > Math.abs(chunkMin - 0) ? chunkMax : chunkMin);
    }
    return result;
  }

  function renderSequenceTable() {
    var tbody = $("#sequenceBody");
    if (sequence.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="7">暂无音调 — 调节参数后点击"加入序列"</td></tr>';
    } else {
      tbody.innerHTML = sequence
        .map(function (item, i) {
          var volPct = item.volume != null ? Math.round(item.volume * 100) : Math.round(getVolume() * 100);
          return (
            '<tr>' +
            '<td>' + (i + 1) + '</td>' +
            '<td><input type="number" value="' + item.freq + '" min="20" max="20000" data-idx="' + i + '" data-field="freq"></td>' +
            '<td><input type="number" value="' + item.duration + '" min="10" max="5000" data-idx="' + i + '" data-field="duration"></td>' +
            '<td><input type="number" value="' + item.gap + '" min="0" max="5000" data-idx="' + i + '" data-field="gap"></td>' +
            '<td><input type="number" value="' + volPct + '" min="1" max="100" data-idx="' + i + '" data-field="volume"></td>' +
            '<td><select data-idx="' + i + '" data-field="wave">' +
              '<option value="square"' + (item.wave === "square" ? " selected" : "") + '>方波</option>' +
              '<option value="sine"' + (item.wave === "sine" ? " selected" : "") + '>正弦波</option>' +
              '<option value="sawtooth"' + (item.wave === "sawtooth" ? " selected" : "") + '>锯齿波</option>' +
              '<option value="triangle"' + (item.wave === "triangle" ? " selected" : "") + '>三角波</option>' +
            '</select></td>' +
            '<td>' +
              '<div class="row-actions">' +
                '<button class="btn-primary btn-small" data-action="preview" data-idx="' + i + '">试听</button>' +
                '<button class="btn-secondary btn-small" data-action="moveUp" data-idx="' + i + '"' + (i === 0 ? " disabled" : "") + '>↑</button>' +
                '<button class="btn-secondary btn-small" data-action="moveDown" data-idx="' + i + '"' + (i === sequence.length - 1 ? " disabled" : "") + '>↓</button>' +
                '<button class="btn-danger btn-small" data-action="delete" data-idx="' + i + '">删除</button>' +
              '</div>' +
            '</td>' +
            '</tr>'
          );
        })
        .join("");
    }

    var totalDur = sequence.reduce(function (s, e) { return s + e.duration + (e.gap || 0); }, 0);
    var summary = $("#sequenceSummary");
    if (sequence.length > 0) {
      summary.innerHTML = "共 " + sequence.length + " 个音调，总时长约 " + totalDur + "ms";
    } else {
      summary.innerHTML = "暂无序列";
    }
  }

  function addToSequence() {
    sequence.push({ freq: getFreq(), duration: getDuration(), gap: getGap(), wave: getWave(), volume: getVolume() });
    renderSequenceTable();
    drawSequenceWaveform();
  }

  function loadPreset(presetName) {
    var preset = PRESETS.find(function (p) { return p.name === presetName; });
    if (preset) {
      sequence = preset.pattern.map(function (e) {
        return { freq: e.freq || 0, duration: e.duration || 200, gap: e.gap || 0, wave: e.wave || "square" };
      });
      renderSequenceTable();
      drawSequenceWaveform();
      highlightPresetButton(presetName);
    }
  }

  function highlightPresetButton(name) {
    $$(".preset-btn").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.preset === name);
    });
  }

  function renderPresetButtons() {
    var container = $("#presetButtons");
    container.innerHTML = PRESETS
      .map(function (p) {
        return '<button class="preset-btn" data-preset="' + p.name + '" title="' + p.totalDuration + 'ms">' + p.label + '</button>';
      })
      .join("");
  }

  function generateLocalWaveform(freq, duration, wave, volume) {
    var samples = generateSamples(freq, duration, wave, volume);
    return downsampleForDisplay(samples, 2000);
  }

  function generateLocalPatternWaveform(pattern, volume) {
    var samples = generatePatternSamples(pattern, volume);
    return downsampleForDisplay(samples, 2000);
  }

  function drawLocalWaveform() {
    if (sequence.length > 0) {
      drawSequenceWaveform();
      return;
    }
    currentWaveformData = generateLocalWaveform(getFreq(), getDuration(), getWave(), getVolume());
    drawWaveform(currentWaveformData);
  }

  function drawSequenceWaveform() {
    if (sequence.length === 0) {
      drawEmptyWaveform();
      return;
    }
    currentWaveformData = generateLocalPatternWaveform(sequence, getVolume());
    drawWaveform(currentWaveformData);
  }

  function drawEmptyWaveform() {
    var canvas = waveformCanvas;
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    var w = rect.width || 400;
    var h = 120;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";

    var ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    ctx.fillStyle = "#181715";
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(250, 249, 245, 0.06)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 8]);
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawWaveform(data) {
    if (!data || data.length === 0) { drawEmptyWaveform(); return; }
    var canvas = waveformCanvas;
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    var w = rect.width || 400;
    var h = 120;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";

    var ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    ctx.fillStyle = "#181715";
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(250, 249, 245, 0.06)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 8]);
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    if (data.length < 2) return;

    var xStep = w / (data.length - 1);
    var midY = h / 2;
    var amp = h * 0.42;

    drawWaveformMarkers(ctx, w, h, midY, data.length, xStep);

    ctx.strokeStyle = "#cc785c";
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    for (var i = 0; i < data.length; i++) {
      var x = i * xStep;
      var y = midY - data[i] * amp;
      if (i === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
    }
    ctx.stroke();
  }

  function drawWaveformMarkers(ctx, w, h, midY, dataLen, xStep) {
    if (sequence.length === 0) return;

    var totalDur = sequence.reduce(function (s, e) { return s + e.duration + (e.gap || 0); }, 0);
    if (totalDur <= 0) return;

    var sampleDurMs = totalDur / dataLen;
    var accumulatedSamples = 0;
    var markerColor = "rgba(250, 249, 245, 0.12)";
    var markerTextColor = "rgba(250, 249, 245, 0.35)";
    var volBarColor = "rgba(204, 120, 92, 0.35)";
    var volBarBg = "rgba(250, 249, 245, 0.04)";

    var bottomPad = 18;

    for (var i = 0; i < sequence.length; i++) {
      var item = sequence[i];
      var startSample = accumulatedSamples;
      var toneSamples = Math.round(item.duration / sampleDurMs);
      var gapSamples = Math.round((item.gap || 0) / sampleDurMs);
      var endSample = startSample + toneSamples;

      var startX = startSample * xStep;
      var endX = endSample * xStep;

      if (i > 0) {
        ctx.strokeStyle = markerColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(startX, 4);
        ctx.lineTo(startX, h - bottomPad);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (item.freq > 0 && toneSamples > 0) {
        var barW = Math.max(3, Math.min(8, (endX - startX) * 0.15));
        var barH = 16;
        var barX = startX + 3;
        var barY = 4;

        ctx.fillStyle = volBarBg;
        ctx.fillRect(barX, barY, barW, barH);

        var volRatio = (item.volume != null ? item.volume : getVolume());
        ctx.fillStyle = volBarColor;
        ctx.fillRect(barX, barY + barH * (1 - volRatio), barW, barH * volRatio);

        ctx.fillStyle = markerTextColor;
        ctx.font = "9px 'JetBrains Mono', monospace";
        ctx.textAlign = "left";
        ctx.fillText(item.duration + "ms", barX, h - 4);
      }

      accumulatedSamples += toneSamples + gapSamples;
    }

    ctx.strokeStyle = markerColor;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    var finalX = accumulatedSamples * xStep;
    ctx.moveTo(finalX, 4);
    ctx.lineTo(finalX, h - bottomPad);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function setLiveError(msg) {
    liveWaveState.textContent = msg;
    liveWaveState.className = "live-wave-state error";
    liveWaveOverlay.classList.remove("hidden");
  }

  function setLiveReady() {
    liveWaveOverlay.classList.add("hidden");
    liveWaveParams.classList.add("visible");
  }

  function initLiveWaveform() {
    try {
      var testCanvas = document.createElement("canvas");
      var testCtx = testCanvas.getContext("2d");
      if (!testCtx) throw new Error("Canvas 2D 不可用");

      startLiveWaveform();
      setLiveReady();
    } catch (e) {
      setLiveError("波形渲染初始化失败");
    }
  }

  function startLiveWaveform() {
    if (liveAnimId) return;
    liveFpsTimer = performance.now();
    liveFpsCounter = 0;
    liveFpsDisplay = liveTargetFps;
    liveLastFrameTime = performance.now();
    animateLiveWaveform();
  }

  function animateLiveWaveform() {
    if (livePaused) {
      liveAnimId = requestAnimationFrame(animateLiveWaveform);
      return;
    }

    try {
      var now = performance.now();
      var elapsed = now - liveLastFrameTime;

      if (elapsed < liveFrameInterval) {
        liveAnimId = requestAnimationFrame(animateLiveWaveform);
        return;
      }

      liveLastFrameTime = now - (elapsed % liveFrameInterval);

      liveFpsCounter++;
      if (now - liveFpsTimer >= 1000) {
        liveFpsDisplay = liveFpsCounter;
        liveFpsCounter = 0;
        liveFpsTimer = now;
      }

      drawLiveFrame(elapsed);
    } catch (e) {
      setLiveError("波形渲染错误");
      stopLiveWaveform();
      return;
    }

    liveAnimId = requestAnimationFrame(animateLiveWaveform);
  }

  function drawLiveFrame(dt) {
    var canvas = liveWaveCanvas;
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    var w = rect.width;
    var h = rect.height;

    if (w <= 0 || h <= 0) return;

    var pw = Math.round(w * dpr);
    var ph = Math.round(h * dpr);

    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    }

    var freq = getFreq();
    var waveType = getWave();
    var volume = getVolume();
    var durationMs = getDuration();
    var gapMs = getGap();
    var totalMs = durationMs + gapMs;

    var curParams = freq + "|" + waveType + "|" + volume + "|" + durationMs + "|" + gapMs;
    if (liveCycleParams !== curParams) {
      var toneSamples = generateSamples(freq, durationMs, waveType, volume);
      var gapSamples = gapMs > 0 ? generateSilence(gapMs) : new Float32Array(0);
      liveCycleSamples = new Float32Array(toneSamples.length + gapSamples.length);
      liveCycleSamples.set(toneSamples, 0);
      liveCycleSamples.set(gapSamples, toneSamples.length);
      liveCycleTotalMs = totalMs;
      liveCycleParams = curParams;
      liveCycleTime = 0;
    }

    liveCycleTime += dt;
    if (liveCycleTime >= liveCycleTotalMs) {
      liveCycleTime = liveCycleTime % liveCycleTotalMs;
    }

    var colors = {
      bg: "#181715",
      grid: "rgba(250, 249, 245, 0.05)",
      gridMajor: "rgba(250, 249, 245, 0.08)",
      wave: "#cc785c",
      waveGlow: "rgba(204, 120, 92, 0.15)",
      wavePast: "rgba(204, 120, 92, 0.35)",
      wavePastGlow: "rgba(204, 120, 92, 0.08)",
      scanLine: "rgba(204, 120, 92, 0.7)",
      spectrum: "rgba(93, 184, 166, 0.6)",
      spectrumBar: "#5db8a6",
      text: "#8e8b82",
      highlight: "#faf9f5",
      durationZone: "rgba(204, 120, 92, 0.03)",
      gapZone: "rgba(93, 184, 166, 0.03)"
    };

    var margin = { top: 8, right: 8, bottom: 56, left: 36 };
    var plotW = w - margin.left - margin.right;
    var plotH = h - margin.top - margin.bottom;
    var midY = margin.top + plotH / 2;

    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, w, h);

    var durationRatio = durationMs / totalMs;
    var durationX = margin.left + plotW * durationRatio;

    ctx.fillStyle = colors.durationZone;
    ctx.fillRect(margin.left, margin.top, plotW * durationRatio, plotH);
    if (gapMs > 0) {
      ctx.fillStyle = colors.gapZone;
      ctx.fillRect(durationX, margin.top, plotW * (1 - durationRatio), plotH);
    }

    ctx.strokeStyle = colors.gridMajor;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(margin.left, midY);
    ctx.lineTo(w - margin.right, midY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 0.5;
    ctx.setLineDash([2, 6]);
    var baseAmpRange = plotH * 0.44;
    var minWaveRatio = 0.075;
    var ampRange = baseAmpRange / Math.max(volume, minWaveRatio);
    ctx.beginPath();
    ctx.moveTo(margin.left, midY - baseAmpRange);
    ctx.lineTo(w - margin.right, midY - baseAmpRange);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(margin.left, midY + baseAmpRange);
    ctx.lineTo(w - margin.right, midY + baseAmpRange);
    ctx.stroke();
    ctx.setLineDash([]);

    var volPctForScale = Math.round(volume * 100);

    ctx.strokeStyle = "rgba(250, 249, 245, 0.06)";
    ctx.lineWidth = 0.5;
    ctx.setLineDash([3, 5]);
    if (volume < 1) {
      var refAmpPx = baseAmpRange * volume;
      if (refAmpPx > 8) {
        ctx.beginPath();
        ctx.moveTo(margin.left, midY - refAmpPx);
        ctx.lineTo(w - margin.right, midY - refAmpPx);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(margin.left, midY + refAmpPx);
        ctx.lineTo(w - margin.right, midY + refAmpPx);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);

    ctx.fillStyle = colors.text;
    ctx.font = "10px 'JetBrains Mono', monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    var curAmpPx = ampRange * volume;
    var refAmpPx2 = baseAmpRange;
    var labelOffset = 14;

    if (volume < 1 && Math.abs(curAmpPx - refAmpPx2) < labelOffset) {
      ctx.fillText(volPctForScale + "%", margin.left - 4, midY - curAmpPx - labelOffset);
      ctx.fillText("-" + volPctForScale + "%", margin.left - 4, midY + curAmpPx + labelOffset);
    } else {
      ctx.fillText(volPctForScale + "%", margin.left - 4, midY - curAmpPx);
      ctx.fillText("-" + volPctForScale + "%", margin.left - 4, midY + curAmpPx);
    }
    ctx.fillText("0%", margin.left - 4, midY);

    if (volume < 1) {
      ctx.fillStyle = "rgba(250, 249, 245, 0.35)";
      if (Math.abs(curAmpPx - refAmpPx2) < labelOffset) {
        ctx.fillText("100%", margin.left - 4, midY - baseAmpRange + labelOffset);
        ctx.fillText("-100%", margin.left - 4, midY + baseAmpRange - labelOffset);
      } else {
        ctx.fillText("100%", margin.left - 4, midY - baseAmpRange);
        ctx.fillText("-100%", margin.left - 4, midY + baseAmpRange);
      }
    }

    ctx.textAlign = "left";

    if (gapMs > 0) {
      ctx.strokeStyle = "rgba(93, 184, 166, 0.15)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(durationX, margin.top);
      ctx.lineTo(durationX, margin.top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(margin.left, margin.top, plotW, plotH);
    ctx.clip();

    var samples = liveCycleSamples;
    var totalSamples = samples.length;
    if (totalSamples > 0) {
      var scanRatio = liveCycleTime / liveCycleTotalMs;
      var scanSampleIdx = scanRatio * totalSamples;

      var step = Math.max(1, Math.floor(totalSamples / plotW));
      var displayPoints = Math.ceil(totalSamples / step);

      ctx.strokeStyle = colors.wavePastGlow;
      ctx.lineWidth = 4;
      ctx.beginPath();
      for (var pi = 0; pi < displayPoints; pi++) {
        var si = Math.min(pi * step, totalSamples - 1);
        var xRatio = si / totalSamples;
        var px = margin.left + xRatio * plotW;
        var py = midY - samples[si] * ampRange;
        if (pi === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();

      ctx.strokeStyle = colors.wavePast;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (var pi2 = 0; pi2 < displayPoints; pi2++) {
        var si2 = Math.min(pi2 * step, totalSamples - 1);
        var xRatio2 = si2 / totalSamples;
        var px2 = margin.left + xRatio2 * plotW;
        var py2 = midY - samples[si2] * ampRange;
        if (pi2 === 0) ctx.moveTo(px2, py2);
        else ctx.lineTo(px2, py2);
      }
      ctx.stroke();

      if (liveSmooth) {
        var scanX = margin.left + scanRatio * plotW;
        var scanSample = Math.min(Math.floor(scanSampleIdx), totalSamples - 1);
        var scanY = midY - samples[scanSample] * ampRange;

        ctx.strokeStyle = colors.scanLine;
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(scanX, margin.top);
        ctx.lineTo(scanX, margin.top + plotH);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(scanX, scanY, 3, 0, Math.PI * 2);
        ctx.fillStyle = colors.wave;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(scanX, scanY, 6, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(204, 120, 92, 0.25)";
        ctx.fill();
      } else {
        var scanX2 = margin.left + scanRatio * plotW;
        var scanSample2 = Math.min(Math.floor(scanSampleIdx), totalSamples - 1);
        var scanY2 = midY - samples[scanSample2] * ampRange;

        ctx.strokeStyle = colors.waveGlow;
        ctx.lineWidth = 5;
        ctx.beginPath();
        var futureStart = Math.floor(scanSampleIdx);
        for (var fi = futureStart; fi < totalSamples; fi += step) {
          var fx = margin.left + (fi / totalSamples) * plotW;
          var fy = midY - samples[Math.min(fi, totalSamples - 1)] * ampRange;
          if (fi === futureStart) ctx.moveTo(fx, fy);
          else ctx.lineTo(fx, fy);
        }
        ctx.stroke();

        ctx.strokeStyle = colors.wave;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (var fi2 = futureStart; fi2 < totalSamples; fi2 += step) {
          var fx2 = margin.left + (fi2 / totalSamples) * plotW;
          var fy2 = midY - samples[Math.min(fi2, totalSamples - 1)] * ampRange;
          if (fi2 === futureStart) ctx.moveTo(fx2, fy2);
          else ctx.lineTo(fx2, fy2);
        }
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(scanX2, scanY2, 3, 0, Math.PI * 2);
        ctx.fillStyle = colors.wave;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(scanX2, scanY2, 6, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(204, 120, 92, 0.25)";
        ctx.fill();
      }
    }

    ctx.restore();

    ctx.fillStyle = colors.text;
    ctx.font = "9px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    var tickStep;
    if (totalMs <= 100) tickStep = 10;
    else if (totalMs <= 300) tickStep = 25;
    else if (totalMs <= 500) tickStep = 50;
    else if (totalMs <= 1000) tickStep = 100;
    else if (totalMs <= 2000) tickStep = 200;
    else tickStep = 500;

    var xTickY = margin.top + plotH + 2;
    for (var tMs = 0; tMs <= totalMs; tMs += tickStep) {
      var tx = margin.left + (tMs / totalMs) * plotW;
      ctx.fillText(tMs + "ms", tx, xTickY);
      ctx.strokeStyle = "rgba(250, 249, 245, 0.08)";
      ctx.lineWidth = 0.5;
      ctx.setLineDash([1, 3]);
      ctx.beginPath();
      ctx.moveTo(tx, margin.top);
      ctx.lineTo(tx, margin.top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (gapMs > 0) {
      ctx.fillStyle = "rgba(93, 184, 166, 0.5)";
      ctx.font = "8px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      var gapCenterX = durationX + (w - margin.right - durationX) / 2;
      ctx.fillText("gap", gapCenterX, xTickY + 10);
    }

    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    drawSpectrumBars(ctx, freq, waveType, volume, margin, w, h, midY, colors);

    var volPct = Math.round(volume * 100);
    if (lwpFreq) lwpFreq.textContent = freq + " Hz";
    if (lwpWave) lwpWave.textContent = mapWaveLabel(waveType);
    if (lwpVol) lwpVol.textContent = volPct + "%";
    if (lwpDur) lwpDur.textContent = getDuration() + " ms";
    if (lwpGap) lwpGap.textContent = getGap() + " ms";
    if (lwpFps) lwpFps.textContent = liveFpsDisplay;
  }

  function drawSpectrumBars(ctx, freq, waveType, volume, margin, w, h, midY, colors) {
    var barAreaH = 20;
    var barAreaY = h - margin.bottom - barAreaH - 2;
    var barAreaLeft = margin.left;
    var barAreaRight = w - margin.right;
    var barAreaW = barAreaRight - barAreaLeft;

    var harmonics = getHarmonics(waveType, 8);
    var barCount = harmonics.length;
    var barWidth = Math.max(2, (barAreaW / barCount) - 2);
    var barGap = 2;
    var totalBarsW = barCount * (barWidth + barGap) - barGap;

    var startX = barAreaLeft + (barAreaW - totalBarsW) / 2;

    ctx.fillStyle = "rgba(250, 249, 245, 0.03)";
    ctx.fillRect(barAreaLeft, barAreaY, barAreaW, barAreaH);

    for (var i = 0; i < barCount; i++) {
      var x = startX + i * (barWidth + barGap);
      var barHeight = barAreaH * harmonics[i];

      var isFundamental = (i === 0);
      ctx.fillStyle = isFundamental
        ? colors.wave
        : colors.spectrumBar;

      ctx.globalAlpha = isFundamental ? 0.9 : 0.45;
      ctx.fillRect(x, barAreaY + barAreaH - barHeight, barWidth, barHeight);
      ctx.globalAlpha = 1;
    }
  }

  function getHarmonics(waveType, count) {
    var result = [];
    if (waveType === "sine") {
      result.push(1);
      for (var i = 1; i < count; i++) result.push(0);
    } else if (waveType === "square") {
      for (var i = 0; i < count; i++) {
        var n = i * 2 + 1;
        result.push(1 / n);
      }
    } else if (waveType === "sawtooth") {
      for (var i = 0; i < count; i++) {
        var n = i + 1;
        result.push(1 / n);
      }
    } else if (waveType === "triangle") {
      for (var i = 0; i < count; i++) {
        var n = i * 2 + 1;
        result.push(1 / (n * n));
      }
    } else {
      for (var i = 0; i < count; i++) result.push(i === 0 ? 1 : 0);
    }
    return result;
  }

  function stopLiveWaveform() {
    if (liveAnimId) {
      cancelAnimationFrame(liveAnimId);
      liveAnimId = null;
    }
  }

  function saveAndDownload() {
    var samples;
    var filenameBase;

    if (sequence.length > 0) {
      samples = generatePatternSamples(sequence, getVolume());
      filenameBase = "beep_pattern";
    } else {
      samples = generateSamples(getFreq(), getDuration(), getWave(), getVolume());
      filenameBase = "beep";
    }

    var wavBuffer = encodeWav(samples);
    var blob = new Blob([wavBuffer], { type: "audio/wav" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filenameBase + "_" + Date.now() + ".wav";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  function exportJSON() {
    if (sequence.length === 0) { alert("序列为空，无法导出"); return; }
    var json = JSON.stringify(sequence, null, 2);
    var blob = new Blob([json], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "beep_pattern_" + Date.now() + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  function importJSON(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var data = JSON.parse(e.target.result);
        if (!Array.isArray(data)) throw new Error("JSON 格式错误，需要数组");
        sequence = data.map(function (item) {
          return {
            freq: Math.max(20, Math.min(20000, item.freq || 4000)),
            duration: Math.max(10, Math.min(5000, item.duration || 200)),
            gap: Math.max(0, Math.min(5000, item.gap || 0)),
            wave: ["sine", "square", "sawtooth", "triangle"].indexOf(item.wave) !== -1 ? item.wave : "square",
            volume: item.volume != null ? Math.max(0.01, Math.min(1, item.volume)) : null,
          };
        });
        renderSequenceTable();
        drawSequenceWaveform();
        highlightPresetButton(null);
      } catch (err) {
        alert("导入失败: " + err.message);
      }
    };
    reader.readAsText(file);
  }

  function handleSeqAction(action, idx) {
    switch (action) {
      case "preview":
        playPreview(sequence[idx].freq, sequence[idx].duration, sequence[idx].wave, sequence[idx].volume);
        break;
      case "delete":
        sequence.splice(idx, 1);
        renderSequenceTable();
        drawSequenceWaveform();
        break;
      case "moveUp":
        if (idx > 0) {
          var t1 = sequence[idx]; sequence[idx] = sequence[idx - 1]; sequence[idx - 1] = t1;
          renderSequenceTable();
          drawSequenceWaveform();
        }
        break;
      case "moveDown":
        if (idx < sequence.length - 1) {
          var t2 = sequence[idx]; sequence[idx] = sequence[idx + 1]; sequence[idx + 1] = t2;
          renderSequenceTable();
          drawSequenceWaveform();
        }
        break;
    }
  }

  $("#btnPreviewSingle").addEventListener("click", function () {
    playPreview(getFreq(), getDuration(), getWave());
    drawLocalWaveform();
  });

  $("#btnAddToSequence").addEventListener("click", addToSequence);

  $("#btnPlayAll").addEventListener("click", function () {
    playSequence();
    if (sequence.length > 0) drawSequenceWaveform();
  });

  $("#btnStopAll").addEventListener("click", function () {
    stopAllAudio();
  });

  $("#btnClearSequence").addEventListener("click", function () {
    sequence = [];
    renderSequenceTable();
    drawEmptyWaveform();
    currentWaveformData = null;
    stopProgress();
    highlightPresetButton(null);
  });

  $("#btnExportJSON").addEventListener("click", exportJSON);
  $("#btnImportJSON").addEventListener("click", function () { $("#importFile").click(); });
  $("#importFile").addEventListener("change", function (e) {
    if (e.target.files[0]) { importJSON(e.target.files[0]); e.target.value = ""; }
  });

  $("#btnSavePattern").addEventListener("click", saveAndDownload);

  $("#sequenceBody").addEventListener("click", function (e) {
    var btn = e.target.closest("button");
    if (!btn) return;
    var action = btn.dataset.action;
    var idx = parseInt(btn.dataset.idx);
    if (action && !isNaN(idx)) { handleSeqAction(action, idx); }
  });

  $("#sequenceBody").addEventListener("change", function (e) {
    var target = e.target;
    if (!target.dataset.idx) return;
    var idx = parseInt(target.dataset.idx);
    var field = target.dataset.field;
    if (isNaN(idx) || !field) return;
    if (field === "wave") {
      sequence[idx][field] = target.value;
    } else if (field === "volume") {
      var v = parseInt(target.value);
      if (!isNaN(v)) { sequence[idx][field] = Math.max(1, Math.min(100, v)) / 100; }
    } else {
      var v = parseInt(target.value);
      if (!isNaN(v)) { sequence[idx][field] = v; }
    }
    drawSequenceWaveform();
  });

  $("#presetButtons").addEventListener("click", function (e) {
    var btn = e.target.closest(".preset-btn");
    if (btn && btn.dataset.preset) { loadPreset(btn.dataset.preset); }
  });

  [freqSlider, durSlider, gapSlider, volSlider, waveSelect].forEach(function (el) {
    el.addEventListener("change", drawLocalWaveform);
    el.addEventListener("input", drawLocalWaveform);
  });

  var resizeTimeout;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(function () {
      if (currentWaveformData) { drawWaveform(currentWaveformData); }
    }, 150);
  });

  btnLiveSmooth.addEventListener("click", function () {
    liveSmooth = !liveSmooth;
    if (liveSmooth) {
      btnLiveSmooth.classList.add("smooth-active");
      smoothLabel.textContent = "平滑开";
    } else {
      btnLiveSmooth.classList.remove("smooth-active");
      smoothLabel.textContent = "平滑";
    }
  });

  $("#btnLiveRefresh").addEventListener("click", function () {
    try {
      liveCycleTime = 0;
      drawLiveFrame(liveFrameInterval);
    } catch (e) {
      setLiveError("手动刷新失败");
    }
  });

  btnLivePause.addEventListener("click", function () {
    livePaused = !livePaused;
    if (livePaused) {
      pauseIcon.textContent = "▶";
      pauseLabel.textContent = "继续";
      btnLivePause.classList.add("paused");
    } else {
      pauseIcon.textContent = "⏸";
      pauseLabel.textContent = "暂停";
      btnLivePause.classList.remove("paused");
      liveLastFrameTime = performance.now();
    }
  });

  liveFpsSelect.addEventListener("change", function () {
    liveTargetFps = parseFloat(liveFpsSelect.value) || 30;
    liveFrameInterval = 1000 / liveTargetFps;
  });

  window.addEventListener("beforeunload", function () {
    stopLiveWaveform();
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      stopLiveWaveform();
    } else if (!livePaused) {
      startLiveWaveform();
    }
  });

  renderPresetButtons();
  renderSequenceTable();
  drawLocalWaveform();
  drawEmptyWaveform();
  initLiveWaveform();
})();
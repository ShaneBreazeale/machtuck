// WebAudio: wind, engines, overspeed clacker, stall horn, AP disconnect, thunder, rain, structural bang, voice callouts.
export class Audio {
  constructor() { this.ctx = null; this.muted = false; this.lastVoice = {}; }
  start() {
    if (this.ctx) return; const C = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = C.createGain(); this.master.gain.value = 0.7; this.master.connect(C.destination);
    const noiseBuf = C.createBuffer(1, C.sampleRate * 2, C.sampleRate); const d = noiseBuf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0; for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11; }
    this.noiseBuf = noiseBuf;
    const mk = (type, freq, q) => { const s = C.createBufferSource(); s.buffer = noiseBuf; s.loop = true; const f = C.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; const g = C.createGain(); g.gain.value = 0; s.connect(f); f.connect(g); g.connect(this.master); s.start(); return { s, f, g }; };
    this.wind = mk('lowpass', 400, 0.5);
    this.rain = mk('highpass', 2500, 0.7);
    this.engN = mk('bandpass', 1800, 1.5);
    this.eng = C.createOscillator(); this.eng.type = 'sawtooth'; this.eng.frequency.value = 95; this.engG = C.createGain(); this.engG.gain.value = 0; const ef = C.createBiquadFilter(); ef.type = 'lowpass'; ef.frequency.value = 500;
    this.eng.connect(ef); ef.connect(this.engG); this.engG.connect(this.master); this.eng.start();
    this.eng2 = C.createOscillator(); this.eng2.type = 'sawtooth'; this.eng2.frequency.value = 97; this.eng2.connect(ef); this.eng2.start();
    this.clk = C.createOscillator(); this.clk.type = 'square'; this.clk.frequency.value = 1400; this.clkG = C.createGain(); this.clkG.gain.value = 0; this.clk.connect(this.clkG); this.clkG.connect(this.master); this.clk.start();
    this.horn = C.createOscillator(); this.horn.type = 'triangle'; this.horn.frequency.value = 330; this.hornG = C.createGain(); this.hornG.gain.value = 0; this.horn.connect(this.hornG); this.hornG.connect(this.master); this.horn.start();
    this.shaker = mk('lowpass', 60, 1); // stick shaker rumble
    this.t = 0;
  }
  update(dt, S) {
    if (!this.ctx) return; const C = this.ctx; this.t += dt; const now = C.currentTime;
    const m = this.muted ? 0 : 1;
    const q = Math.min(S.qbar / 20000, 1.5);
    this.wind.g.gain.setTargetAtTime(m * (0.08 + 0.9 * q) * (S.ext ? 0.6 : 1), now, 0.1);
    this.wind.f.frequency.setTargetAtTime(250 + 2500 * q, now, 0.1);
    this.rain.g.gain.setTargetAtTime(m * 0.5 * S.inCloud * Math.min(1, S.V / 150), now, 0.2);
    const n1 = S.n1; this.eng.frequency.setTargetAtTime(70 + 110 * n1, now, 0.3); this.eng2.frequency.setTargetAtTime(72 + 112 * n1, now, 0.3);
    this.engG.gain.setTargetAtTime(m * (0.02 + 0.12 * n1) * (S.ext ? 1.4 : 1) * (S.broken ? 0 : 1), now, 0.2);
    this.engN.g.gain.setTargetAtTime(m * (0.02 + 0.25 * n1 * n1) * (S.broken ? 0 : 1), now, 0.2);
    this.engN.f.frequency.setTargetAtTime(800 + 2500 * n1, now, 0.3);
    this.clkG.gain.setTargetAtTime(m * (S.overspeed && (Math.floor(this.t * 9) % 2 === 0) ? 0.08 : 0), now, 0.005);
    this.hornG.gain.setTargetAtTime(m * (S.stall && (Math.floor(this.t * 4) % 2 === 0) ? 0.12 : 0), now, 0.01);
    this.shaker.g.gain.setTargetAtTime(m * (S.buffet ? 0.9 : 0) * Math.min(1, q * 2), now, 0.05);
    if (S.flash > 0.95 && !this.flashLatched) { this.flashLatched = true; setTimeout(() => this.thunder(S.flashDist), 300 + Math.random() * 1500); }
    if (S.flash < 0.5) this.flashLatched = false;
  }
  burst(freq, dur, gain, type = 'lowpass') {
    if (!this.ctx || this.muted) return; const C = this.ctx; const s = C.createBufferSource(); s.buffer = this.noiseBuf; const f = C.createBiquadFilter(); f.type = type; f.frequency.value = freq; const g = C.createGain();
    g.gain.setValueAtTime(gain, C.currentTime); g.gain.exponentialRampToValueAtTime(0.001, C.currentTime + dur); s.connect(f); f.connect(g); g.connect(this.master); s.start(); s.stop(C.currentTime + dur);
  }
  thunder(dist = 3000) { this.burst(140, 2.5 + Math.random() * 2, Math.max(0.1, 1.2 - dist / 8000)); }
  bang() { this.burst(300, 1.2, 1.5); setTimeout(() => this.burst(90, 2.5, 0.8), 150); }
  apDisconnect() {
    if (!this.ctx || this.muted) return; const C = this.ctx; const t0 = C.currentTime;
    // "cavalry charge" style warble
    [0, 0.18, 0.36, 0.54, 0.72, 0.9].forEach((dt, i) => { const o = C.createOscillator(); o.type = 'square'; o.frequency.value = [880, 1175, 880, 1175, 880, 1175][i]; const g = C.createGain(); g.gain.setValueAtTime(0.0001, t0 + dt); g.gain.exponentialRampToValueAtTime(0.09, t0 + dt + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.16); o.connect(g); g.connect(this.master); o.start(t0 + dt); o.stop(t0 + dt + 0.2); });
  }
  say(text, minGap = 2.5) {
    if (this.muted || !('speechSynthesis' in window)) return; const n = performance.now() / 1000;
    if (this.lastVoice[text] && n - this.lastVoice[text] < minGap) return; this.lastVoice[text] = n;
    const u = new SpeechSynthesisUtterance(text); u.rate = 1.05; u.pitch = 0.9; u.volume = 0.9; speechSynthesis.speak(u);
  }
}

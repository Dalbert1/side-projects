// Synthesized detonation rumble. No audio files, just WebAudio noise and a sub thump.

let ctx = null
let master = null

// Must run inside a tap or click so mobile browsers allow audio later.
export function unlockAudio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext
      if (!AC) return
      ctx = new AC()
      const comp = ctx.createDynamicsCompressor()
      master = ctx.createGain()
      master.gain.value = 0.7
      master.connect(comp).connect(ctx.destination)
    }
    if (ctx.state === 'suspended') ctx.resume()
  } catch {
    ctx = null
  }
}

// intensity runs 0 (tiny) to 1 (Tsar Bomba).
export function playBoom(intensity = 0.5) {
  if (!ctx || !master) return
  const now = ctx.currentTime
  const dur = 2.2 + intensity * 3.5

  const len = Math.floor(ctx.sampleRate * dur)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buf.getChannelData(0)
  let last = 0
  for (let i = 0; i < len; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02
    data[i] = last * 3.5
  }

  const noise = ctx.createBufferSource()
  noise.buffer = buf
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.setValueAtTime(2400 - intensity * 1200, now)
  lp.frequency.exponentialRampToValueAtTime(60, now + dur)
  const ng = ctx.createGain()
  ng.gain.setValueAtTime(0.0001, now)
  ng.gain.exponentialRampToValueAtTime(1, now + 0.02)
  ng.gain.exponentialRampToValueAtTime(0.0001, now + dur)
  noise.connect(lp).connect(ng).connect(master)
  noise.start(now)
  noise.stop(now + dur)

  const sub = ctx.createOscillator()
  sub.type = 'sine'
  sub.frequency.setValueAtTime(95 - intensity * 40, now)
  sub.frequency.exponentialRampToValueAtTime(24, now + 1.4)
  const sg = ctx.createGain()
  sg.gain.setValueAtTime(0.0001, now)
  sg.gain.exponentialRampToValueAtTime(0.9, now + 0.015)
  sg.gain.exponentialRampToValueAtTime(0.0001, now + 1.8)
  sub.connect(sg).connect(master)
  sub.start(now)
  sub.stop(now + 1.9)
}

import {jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment} from "react/jsx-runtime";import { useEffect, useRef, useState } from 'react'
import { createScene, DEFAULT_PARAMS } from '../lib/scene.ts?v=5df1766eec48759fc778ea470305cd02274d8dfb749dcea9c7eb919af44b761d'

import { createFlameLayer } from '../lib/flame-layer.ts?v=fed7971be4bec7b2677fac9c8362659f1c71e5b8c1db92782292551234bb28bc'











const KEYS = Object.keys(DEFAULT_PARAMS) 

// The line of help for a view: worded for a pointer and keys, or for fingers and the on-screen
// buttons, and saying which way up and down work (like a flight stick, or the plain way).
const hintFor = (view, fingers, stick) => {
  const next = view === 'top' ? 'chase view' : view === 'chase' ? 'the cockpit' : 'overhead'
  const steer =
    view === 'top'
      ? `${fingers ? 'Touch' : 'Move'} to steer`
      : `${fingers ? 'Touch' : 'Point'} to turn · ${stick ? 'Down climbs, up dives' : 'Up climbs, down dives'}`
  return fingers
    ? `${steer} · Tap to roll · Hold Boost for the thrusters · View for ${next}`
    : `${steer} · Click to roll · Hold to fire the thrusters · Space for ${next}`
}
const viewOf = (v) => (v === 'cockpit' ? 'cockpit' : v === 'chase' ? 'chase' : 'top')

// keys that fly the jet: turn, climb / dive and the thrusters
const FLY = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ShiftLeft: 'boost', ShiftRight: 'boost',
  TouchBoost: 'boost', // the on-screen Boost button counts as a key held down
}

export default function FighterJetScene({ pixelSize = 0, showHint = true, touchControls = 'auto', ...rest }) {
  // true where the graphics card cannot draw the smooth flames: they are drawn in pixels instead
  const [noFire, setNoFire] = useState(false)
  // true on a phone or tablet: its main pointer is a finger, or a finger has touched the scene
  const [fingerScreen, setFingerScreen] = useState(false)
  useEffect(() => {
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) setFingerScreen(true)
  }, [])
  const buttons = touchControls === 'on' || (touchControls === 'auto' && fingerScreen)
  const [boosting, setBoosting] = useState(false)
  const heldRef = useRef(new Set()) // the flying keys held down (and the Boost button)
  const sendKeysRef = useRef(() => {})
  // the finger that is steering: which one, when and where it came down, and whether it has moved since
  const steerRef = useRef(null)
  // props → scene settings (anything left out falls back to its default)
  const params = { ...DEFAULT_PARAMS } 
  for (const k of KEYS) {
    const v = (rest )[k]
    if (v !== undefined && v !== null) (params )[k] = v
  }
  if (noFire) params.flameStyle = 'pixel'
  const signature = JSON.stringify(params)

  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const fireRef = useRef(null)
  const sceneRef = useRef(null)
  const paramsRef = useRef(params)
  const pixelRef = useRef(pixelSize)
  const scaleRef = useRef(4)
  const layoutRef = useRef(() => {})
  const [hint, setHint] = useState({ mode: viewOf(params.view), on: true })
  const hintTimer = useRef(0)
  // show the line of help for a view, then let it fade
  const revealHint = (mode, seconds) => {
    setHint({ mode, on: true })
    window.clearTimeout(hintTimer.current)
    hintTimer.current = window.setTimeout(() => setHint((h) => ({ ...h, on: false })), seconds * 1000)
  }
  const revealHintRef = useRef(revealHint)
  revealHintRef.current = revealHint
  paramsRef.current = params
  pixelRef.current = pixelSize

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const scene = createScene(paramsRef.current)
    sceneRef.current = scene
    let image = null
    // the smooth flames have a canvas of their own over the picture, at the screen's full sharpness
    const fire = fireRef.current
    let layer = null
    let fireDead = false
    const onFireLost = (e) => {
      e.preventDefault()
      layer = null
      fireDead = true
      setNoFire(true)
    }
    fire?.addEventListener('webglcontextlost', onFireLost)

    const layout = () => {
      const cw = wrap.clientWidth
      const ch = wrap.clientHeight
      if (!cw || !ch) return
      const auto = Math.min(12, Math.max(2, Math.round(Math.sqrt((cw * ch) / 100000))))
      const px = pixelRef.current > 0 ? Math.round(pixelRef.current) : auto
      const lw = Math.ceil(cw / px)
      const lh = Math.ceil(ch / px)
      if (canvas.width !== lw || canvas.height !== lh) {
        canvas.width = lw
        canvas.height = lh
        scene.resize(lw, lh)
        image = null
      }
      canvas.style.width = lw * px + 'px'
      canvas.style.height = lh * px + 'px'
      canvas.style.left = Math.round((cw - lw * px) / 2) + 'px'
      canvas.style.top = Math.round((ch - lh * px) / 2) + 'px'
      if (fire) {
        const dpr = Math.min(2, window.devicePixelRatio || 1)
        const fw = Math.round(lw * px * dpr)
        const fh = Math.round(lh * px * dpr)
        if (fire.width !== fw || fire.height !== fh) {
          fire.width = fw
          fire.height = fh
        }
        fire.style.width = canvas.style.width
        fire.style.height = canvas.style.height
        fire.style.left = canvas.style.left
        fire.style.top = canvas.style.top
      }
      scaleRef.current = px
    }
    layoutRef.current = layout
    layout()
    const ro = new ResizeObserver(layout)
    ro.observe(wrap)

    let raf = 0
    let last = performance.now()
    const frame = (now) => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000))
      last = now
      if (!scene.width) return
      scene.step(dt)
      const bytes = scene.render()
      if (!image) image = new ImageData(bytes , scene.width, scene.height)
      ctx.putImageData(image, 0, 0)
      // smooth flames, if the scene asked for any this frame
      const flames = scene.flames
      if (fire && flames.count > 0 && !layer && !fireDead) {
        layer = createFlameLayer(fire)
        if (!layer) {
          fireDead = true
          setNoFire(true)
        }
      }
      if (fire && layer) layer.draw(flames.count, flames.data, fire.width / scene.width, now / 1000)
    }
    raf = requestAnimationFrame(frame)

    // Space moves the camera on: overhead → behind the jet → cockpit → overhead;
    // arrows or WASD fly it, Shift fires the thrusters
    const held = heldRef.current
    held.clear()
    const sendKeys = () => {
      let turn = 0
      let climb = 0
      let boost = false
      held.forEach((code) => {
        const k = FLY[code]
        if (k === 'left') turn -= 1
        else if (k === 'right') turn += 1
        else if (k === 'up') climb += 1
        else if (k === 'down') climb -= 1
        else if (k === 'boost') boost = true
      })
      scene.setKeys(turn, climb, boost)
    }
    sendKeysRef.current = sendKeys
    const typing = (e) => {
      const el = e.target 
      return !!el && el !== wrap && (/^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(el.tagName) || el.isContentEditable)
    }
    const onKey = (e) => {
      if (typing(e)) return
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault()
        if (e.repeat) return
        scene.toggleView()
        revealHintRef.current(scene.view, 7)
        return
      }
      if (FLY[e.code] && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.code.startsWith('Arrow')) e.preventDefault()
        held.add(e.code)
        sendKeys()
      }
    }
    const onKeyUp = (e) => {
      if (held.delete(e.code)) sendKeys()
    }
    const onBlur = () => {
      held.clear()
      sendKeys()
      setBoosting(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      window.clearTimeout(hintTimer.current)
      fire?.removeEventListener('webglcontextlost', onFireLost)
      layer?.dispose()
      sceneRef.current = null
    }
  }, [])

  useEffect(() => {
    sceneRef.current?.setParams(paramsRef.current)
  }, [signature])

  useEffect(() => {
    layoutRef.current()
  }, [pixelSize])

  // when the view is switched from the controls, show that view's line of help
  const firstView = useRef(true)
  useEffect(() => {
    if (firstView.current) { firstView.current = false; return }
    revealHintRef.current(viewOf(params.view), 7)
  }, [params.view])

  const toScene = (e) => {
    const r = canvasRef.current.getBoundingClientRect()
    return [(e.clientX - r.left) / scaleRef.current, (e.clientY - r.top) / scaleRef.current] 
  }

  // Fingers fly differently from a mouse: a finger steers for as long as it is down, a quick
  // tap rolls, and the thrusters have a button of their own (so steering does not fire them).
  const byFinger = (e) => touchControls !== 'off' && e.pointerType === 'touch'
  const endFinger = (e, tap) => {
    const s = steerRef.current
    if (!s || s.id !== e.pointerId) return
    steerRef.current = null
    const scene = sceneRef.current
    if (!scene) return
    if (tap && !s.moved && performance.now() - s.t < 260) {
      scene.press()
      scene.release() // a press and release at once is a click: it rolls
    }
    scene.pointerLeave()
  }
  // the on-screen buttons keep their touches to themselves
  const mine = (e) => e.stopPropagation()
  const nextView = () => {
    const scene = sceneRef.current
    if (!scene) return
    scene.toggleView()
    revealHint(scene.view, 7)
    wrapRef.current?.focus({ preventScroll: true }) // so the keys still fly it after a click
  }
  const boostOn = (e) => {
    e.stopPropagation()
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* the touch has already ended */ }
    heldRef.current.add('TouchBoost')
    sendKeysRef.current()
    setBoosting(true)
  }
  const boostOff = (e) => {
    e.stopPropagation()
    heldRef.current.delete('TouchBoost')
    sendKeysRef.current()
    setBoosting(false)
    wrapRef.current?.focus({ preventScroll: true })
  }
  const buttonLook =
    'absolute flex h-14 w-[4.5rem] cursor-pointer select-none items-center justify-center rounded-[4px] border font-mono text-[11px] uppercase leading-none tracking-[0.14em] text-white/90 outline-none transition-colors duration-100 focus-visible:border-white'

  return (
    _jsxs('div', {
      ref: wrapRef,
      tabIndex: 0,
      className: "relative h-screen min-h-[320px] w-full touch-none select-none overflow-hidden bg-[#2468b4] outline-none"        ,
      // (on a phone the screen's height changes as the browser's bars come and go: follow it)
      style: { cursor: 'crosshair', height: '100dvh', WebkitTouchCallout: 'none', WebkitTapHighlightColor: 'transparent' },
      onContextMenu: (e) => { if (fingerScreen) e.preventDefault() },
      onPointerEnter: () => wrapRef.current?.focus({ preventScroll: true }),
      onPointerMove: (e) => {
        if (byFinger(e)) {
          const s = steerRef.current
          if (!s || s.id !== e.pointerId) return
          if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > 12) s.moved = true
        }
        const [x, y] = toScene(e)
        sceneRef.current?.pointerMove(x, y)
      },
      onPointerDown: (e) => {
        const [x, y] = toScene(e)
        if (byFinger(e)) {
          if (!fingerScreen) setFingerScreen(true)
          if (steerRef.current) return // one finger steers; a second one is for the buttons
          steerRef.current = { id: e.pointerId, t: performance.now(), x: e.clientX, y: e.clientY, moved: false }
          sceneRef.current?.pointerMove(x, y)
        } else {
          sceneRef.current?.pointerMove(x, y)
          sceneRef.current?.press()
        }
        wrapRef.current?.focus({ preventScroll: true })
        // the hint stays a little longer, so the tips are still there to read
        if (!hintTimer.current) hintTimer.current = window.setTimeout(() => setHint((h) => ({ ...h, on: false })), 9000)
      },
      onPointerUp: (e) => {
        if (byFinger(e)) endFinger(e, true)
        else sceneRef.current?.release()
      },
      onPointerLeave: (e) => {
        if (byFinger(e)) endFinger(e, false)
        else sceneRef.current?.pointerLeave()
      },
      onPointerCancel: (e) => {
        if (byFinger(e)) endFinger(e, false)
        else sceneRef.current?.pointerLeave()
      },
 children: [
      _jsx('canvas', {
        ref: canvasRef,
        'aria-label': "A pixel-art fighter jet, built from stacked slices, flying over islands. Space moves between the overhead view, the view from behind the jet and the cockpit; arrow keys fly it and Shift fires the thrusters."                                  ,
        role: "img",
        className: "absolute block" ,
        style: { imageRendering: 'pixelated' },}
      )
      /* smooth flames are drawn here, over the picture */
      , _jsx('canvas', { ref: fireRef, 'aria-hidden': "true", className: "pointer-events-none absolute block"  ,} )
      /* the line of help; in the cockpit, and above the touch buttons, it sits at the top */
      , showHint && (
        _jsx('div', {
          className: `pointer-events-none absolute inset-x-0 flex justify-center px-4 transition-opacity duration-700 ${buttons || hint.mode === 'cockpit' ? 'top-4' : 'bottom-4'}`,
          style: { opacity: hint.on ? 1 : 0 },
 children: 
          _jsx('p', {
            className: "rounded-[3px] bg-[#0b1a33]/55 px-2.5 py-1.5 text-center font-mono text-[11px] uppercase leading-none tracking-[0.14em] text-white/90"          ,
            style: { textShadow: '0 1px 0 rgba(0,0,0,.45)' },
 children: 
            hintFor(hint.mode, buttons, params.invertY)
          })
        })
      )
      /* phones and tablets have no Space bar or Shift key: a button for the view, one for the thrusters */
      , buttons && (
        _jsxs(_Fragment, { children: [
          _jsx('button', {
            type: "button",
            'aria-label': "Change view" ,
            className: `${buttonLook} border-white/30 bg-[#0b1a33]/60 active:bg-[#0b1a33]/90`,
            style: { left: 'max(14px, env(safe-area-inset-left))', bottom: 'max(14px, env(safe-area-inset-bottom))', touchAction: 'none' },
            onClick: nextView,
            onPointerDown: mine,
            onPointerMove: mine,
            onPointerUp: mine,
 children: "View"

          })
          , _jsx('button', {
            type: "button",
            'aria-label': "Thrusters: hold to fire"   ,
            'aria-pressed': boosting,
            className: `${buttonLook} ${boosting ? 'border-white/70' : 'border-white/30 bg-[#0b1a33]/60'}`,
            style: {
              right: 'max(14px, env(safe-area-inset-right))',
              bottom: 'max(14px, env(safe-area-inset-bottom))',
              touchAction: 'none',
              backgroundColor: boosting ? params.accentColor : undefined,
            },
            onPointerDown: boostOn,
            onPointerMove: mine,
            onPointerUp: boostOff,
            onPointerCancel: boostOff,
            onLostPointerCapture: boostOff,
            onContextMenu: (e) => e.preventDefault(),
 children: "Boost"

          })
        ]})
      )
    ]})
  )
}

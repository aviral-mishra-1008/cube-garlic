import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { OrbitControls, Text, Edges, Line } from '@react-three/drei'
import * as THREE from 'three'
import './App.css'

const COLORS = [
  { name: 'Black', value: '#000000' },
  { name: 'Red', value: '#ff0000' },
  { name: 'Blue', value: '#0000ff' },
  { name: 'Green', value: '#008000' },
  { name: 'White', value: '#ffffff' },
  { name: 'Purple', value: '#800080' },
]

// Face definitions
const FACES = [
  { id: 0, name: 'Front', pos: [0, 0, 1.25], rot: [0, 0, 0], textRot: [0, 0, 0], text: '1' },
  { id: 1, name: 'Back', pos: [0, 0, -1.25], rot: [0, Math.PI, 0], textRot: [0, 0, 0], text: '2' },
  { id: 2, name: 'Right', pos: [1.25, 0, 0], rot: [0, Math.PI / 2, 0], textRot: [0, 0, 0], text: '3' },
  { id: 3, name: 'Left', pos: [-1.25, 0, 0], rot: [0, -Math.PI / 2, 0], textRot: [0, 0, 0], text: '4' },
  { id: 4, name: 'Top', pos: [0, 1.25, 0], rot: [-Math.PI / 2, 0, 0], textRot: [0, 0, 0], text: '5' },
  { id: 5, name: 'Bottom', pos: [0, -1.25, 0], rot: [Math.PI / 2, 0, 0], textRot: [0, 0, 0], text: '6' },
]

// Adjacency Graph
const CUBE_ADJACENCY = {
  0: [ { face: 4, edge: 1 }, { face: 5, edge: 0 }, { face: 3, edge: 3 }, { face: 2, edge: 2 } ],
  1: [ { face: 4, edge: 0 }, { face: 5, edge: 1 }, { face: 2, edge: 3 }, { face: 3, edge: 2 } ],
  2: [ { face: 4, edge: 3 }, { face: 5, edge: 3 }, { face: 0, edge: 3 }, { face: 1, edge: 2 } ],
  3: [ { face: 4, edge: 2 }, { face: 5, edge: 2 }, { face: 1, edge: 3 }, { face: 0, edge: 2 } ],
  4: [ { face: 1, edge: 0 }, { face: 0, edge: 0 }, { face: 3, edge: 0 }, { face: 2, edge: 0 } ],
  5: [ { face: 0, edge: 1 }, { face: 1, edge: 1 }, { face: 3, edge: 1 }, { face: 2, edge: 1 } ]
}

const CANVAS_SIZE = 512
const FACE_SIZE = 2.5

// --- MATH HELPERS ---

function localUVToGlobal(uv, faceState) {
  const localX = uv.x - 0.5
  const localY = uv.y - 0.5
  const cos = Math.cos(faceState.rot)
  const sin = Math.sin(faceState.rot)
  const rotX = localX * cos - localY * sin
  const rotY = localX * sin + localY * cos
  return { x: faceState.x + rotX, y: faceState.y + rotY }
}

function globalToLocalUV(globalPoint, faceState) {
  const relX = globalPoint.x - faceState.x
  const relY = globalPoint.y - faceState.y
  const cos = Math.cos(-faceState.rot)
  const sin = Math.sin(-faceState.rot)
  const localX = relX * cos - relY * sin
  const localY = relX * sin + relY * cos
  return { x: localX + 0.5, y: localY + 0.5 }
}

function generateVirtualMap(rootFaceId) {
  const map = { [rootFaceId]: { x: 0, y: 0, rot: 0 } }
  const queue = [rootFaceId]
  const visited = new Set([rootFaceId.toString()])

  let iterations = 0
  while (queue.length > 0 && iterations < 50) {
    iterations++
    const currentId = queue.shift()
    const currentState = map[currentId]
    
    CUBE_ADJACENCY[currentId].forEach((conn, edgeIdx) => {
      const neighborId = conn.face
      if (!visited.has(neighborId.toString())) {
        const localVectors = [{ x: 0, y: 1 }, { x: 0, y: -1 }, { x: -1, y: 0 }, { x: 1, y: 0 }]
        const exitVectorLocal = localVectors[edgeIdx]
        
        const cos = Math.cos(currentState.rot)
        const sin = Math.sin(currentState.rot)
        const gridMoveX = Math.round(exitVectorLocal.x * cos - exitVectorLocal.y * sin)
        const gridMoveY = Math.round(exitVectorLocal.x * sin + exitVectorLocal.y * cos)
        
        const neighborEntryEdge = conn.edge
        const entryVectorLocal = localVectors[neighborEntryEdge]
        const entryAngleLocal = Math.atan2(entryVectorLocal.y, entryVectorLocal.x)
        const targetAngleGlobal = Math.atan2(-gridMoveY, -gridMoveX)
        
        let newRot = targetAngleGlobal - entryAngleLocal
        const PI_2 = Math.PI / 2
        newRot = Math.round(newRot / PI_2) * PI_2

        map[neighborId] = {
          x: currentState.x + gridMoveX,
          y: currentState.y + gridMoveY,
          rot: newRot
        }
        
        visited.add(neighborId.toString())
        queue.push(neighborId)
      }
    })
  }
  return map
}

// --- SUB-COMPONENTS ---

function FaceGrid({ n }) {
  const lines = useMemo(() => {
    const l = []
    const half = 1.25 
    const step = 2.5 / n
    for (let i = 1; i < n; i++) {
      const x = -half + i * step
      l.push(<Line key={`v-${i}`} points={[[x, -half, 0], [x, half, 0]]} color="#000000" lineWidth={2} transparent opacity={0.3} />)
    }
    for (let i = 1; i < n; i++) {
      const y = -half + i * step
      l.push(<Line key={`h-${i}`} points={[[-half, y, 0], [half, y, 0]]} color="#000000" lineWidth={2} transparent opacity={0.3} />)
    }
    return l
  }, [n])

  return <group position={[0,0,0.005]}>{lines}</group>
}

function HingeButton({ position, rotation, onClick }) {
  const [hovered, setHovered] = useState(false)
  return (
    <group position={position} rotation={rotation}>
      <mesh 
        position={[0, 0, 0.1]} 
        onClick={(e) => { e.stopPropagation(); onClick() }}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <circleGeometry args={[0.4, 32]} />
        <meshBasicMaterial color={hovered ? "#00ffff" : "#00bcd4"} side={THREE.DoubleSide} />
        <Text position={[0, 0, 0.01]} fontSize={0.5} color="black" anchorX="center" anchorY="middle" fontWeight="bold">+</Text>
      </mesh>
    </group>
  )
}

function FaceMesh({ face, material, unfoldedState, onPointerDown, onPointerMove, onPointerUp, onUnfoldNeighbor, availableNeighbors, mode, gridN, registerMesh }) {
  const meshRef = useRef()
  const FACE_SIZE = 2.5
  
  useEffect(() => {
    if (meshRef.current) registerMesh(face.id, meshRef.current)
  }, [face.id, registerMesh])
  
  useFrame(() => {
    if (!meshRef.current) return
    let targetPos, targetRot
    if (unfoldedState) {
      const GRID_STEP = 2.55 
      targetPos = new THREE.Vector3(unfoldedState.x * GRID_STEP, unfoldedState.y * GRID_STEP, 0)
      targetRot = new THREE.Euler(0, 0, unfoldedState.rot)
    } else {
      targetPos = new THREE.Vector3(...face.pos)
      targetRot = new THREE.Euler(...face.rot)
    }
    meshRef.current.position.lerp(targetPos, 0.1)
    const targetQ = new THREE.Quaternion().setFromEuler(targetRot)
    meshRef.current.quaternion.slerp(targetQ, 0.1)
  })

  const hingePositions = [[0, 1.25, 0], [0, -1.25, 0], [-1.25, 0, 0], [1.25, 0, 0]]
  const [faceHovered, setFaceHovered] = useState(false)

  return (
    <group>
      <mesh
        ref={meshRef}
        material={material}
        onPointerDown={(e) => onPointerDown(e, face.id)}
        onPointerMove={(e) => onPointerMove(e, face.id)}
        onPointerUp={(e) => onPointerUp(e, face.id)}
        onPointerOver={() => setFaceHovered(true)}
        onPointerOut={() => setFaceHovered(false)}
      >
        <planeGeometry args={[FACE_SIZE, FACE_SIZE]} />
        <Edges linewidth={2} color={faceHovered && mode === 'open' && !unfoldedState ? "#00ffff" : "#333"} />
        <FaceGrid n={gridN} />
        {faceHovered && mode === 'open' && !unfoldedState && (
           <mesh position={[0,0,-0.01]}>
              <planeGeometry args={[FACE_SIZE * 1.05, FACE_SIZE * 1.05]} />
              <meshBasicMaterial color="#00ffff" transparent opacity={0.3} />
           </mesh>
        )}
        <Text position={[0, 0, 0.01]} rotation={face.textRot} fontSize={1.2} color="black" anchorX="center" anchorY="middle">{face.text}</Text>
        {unfoldedState && availableNeighbors && availableNeighbors.map((conn, idx) => {
          if (!conn) return null 
          return <HingeButton key={idx} position={hingePositions[idx]} rotation={[0, 0, 0]} onClick={() => onUnfoldNeighbor(face.id, idx)} />
        })}
      </mesh>
    </group>
  )
}

function UnfoldingCube({ mode, color, tool, resetTrigger, gridN, drawings, measurements, onAddDrawing, onAddMeasurement }) {
  const [unfoldedFaces, setUnfoldedFaces] = useState({})
  const meshRefs = useRef({})
  const registerMesh = useCallback((id, mesh) => { meshRefs.current[id] = mesh }, [])

  const [drawingState, setDrawingState] = useState({ 
    isDrawing: false, 
    startFace: null,
    startUV: null, 
    startPoint: null,
    currentPoint: null, 
    currentUV: null,
    currentFace: null,
    distLabel: "0.00"
  })

  // Handle Net Reset
  useEffect(() => { setUnfoldedFaces({}) }, [resetTrigger])
  
  // Initialize Canvases
  const { canvases, textures, materials } = useMemo(() => {
    const canvases = []
    const textures = []
    const materials = []
    for (let i = 0; i < 6; i++) {
      const canvas = document.createElement('canvas')
      canvas.width = CANVAS_SIZE
      canvas.height = CANVAS_SIZE
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#e0e0e0' 
      ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)
      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      canvases.push(canvas)
      textures.push(texture)
      materials.push(new THREE.MeshStandardMaterial({ map: texture, roughness: 0.6, metalness: 0.1, side: THREE.DoubleSide }))
    }
    return { canvases, textures, materials }
  }, [])

  // --- REPAINT SYSTEM ---
  // Re-draws everything from state history whenever drawings/measurements change
  useEffect(() => {
    // 1. Clear All
    canvases.forEach(canvas => {
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#e0e0e0'
      ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)
    })

    // 2. Repaint Drawings
    drawings.forEach(d => {
       paintBatchPaths(d.paths, d.color, d.tool)
    })

    // 3. Repaint Measurements
    measurements.forEach(m => {
       stampTextOnFace(m.faceId, m.u, m.v, m.text)
    })

    // 4. Update
    textures.forEach(t => t.needsUpdate = true)

  }, [drawings, measurements, canvases, textures])

  // Helper functions
  const paintBatchPaths = (paths, drawColor, drawTool) => {
    const isEraser = drawTool === 'eraser'
    const lineWidth = isEraser ? 40 : 10
    const strokeStyle = isEraser ? '#e0e0e0' : drawColor

    Object.keys(paths).forEach(faceId => {
      const points = paths[faceId]
      if (points.length < 2) return

      const canvas = canvases[faceId]
      const ctx = canvas.getContext('2d')
      const texture = textures[faceId]

      ctx.beginPath()
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.lineWidth = lineWidth
      ctx.strokeStyle = strokeStyle

      const startX = points[0].x * CANVAS_SIZE
      const startY = (1 - points[0].y) * CANVAS_SIZE
      ctx.moveTo(startX, startY)

      for(let i=1; i<points.length; i++) {
        const px = points[i].x * CANVAS_SIZE
        const py = (1 - points[i].y) * CANVAS_SIZE
        ctx.lineTo(px, py)
      }
      ctx.stroke()
      texture.needsUpdate = true
    })
  }

  const stampTextOnFace = (faceId, u, v, text) => {
    const canvas = canvases[faceId]
    const ctx = canvas.getContext('2d')
    const texture = textures[faceId]
    
    ctx.font = 'bold 60px Arial'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    
    const x = u * CANVAS_SIZE
    const y = (1 - v) * CANVAS_SIZE
    
    const width = ctx.measureText(text).width + 20
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'
    ctx.fillRect(x - width/2, y - 35, width, 70)
    
    ctx.fillStyle = 'black'
    ctx.fillText(text, x, y)
    texture.needsUpdate = true
  }

  // Live painting for eraser feedback
  const paintDot = (faceId, u, v, drawColor, size) => {
    const canvas = canvases[faceId]
    const ctx = canvas.getContext('2d')
    const texture = textures[faceId]
    const x = u * CANVAS_SIZE
    const y = (1 - v) * CANVAS_SIZE
    const r = size * CANVAS_SIZE
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = drawColor
    ctx.fill()
    texture.needsUpdate = true
  }

  const handlePointerDown = (e, faceIndex) => {
    e.stopPropagation()
    if (mode === 'open') {
      if (Object.keys(unfoldedFaces).length === 0) setUnfoldedFaces({ [faceIndex]: { x: 0, y: 0, rot: 0 } })
      return
    }
    if (mode === 'draw') {
      const hitPoint = e.point.clone()
      
      if (tool === 'eraser') {
         paintDot(faceIndex, e.uv.x, e.uv.y, '#e0e0e0', 0.08) 
      }

      setDrawingState({
        isDrawing: true,
        startFace: faceIndex,
        startUV: e.uv.clone(),
        startPoint: hitPoint,
        currentPoint: hitPoint,
        currentUV: e.uv.clone(),
        currentFace: faceIndex,
        distLabel: "0.00"
      })
    }
  }

  const handlePointerMove = (e, faceIndex) => {
    if (mode === 'draw' && drawingState.isDrawing) {
      e.stopPropagation()
      
      if (!e.uv) return

      let distLabel = "0.00"
      if (tool === 'scale' && drawingState.startPoint) {
         const worldDist = drawingState.startPoint.distanceTo(e.point)
         const gridDist = (worldDist / FACE_SIZE) * gridN
         distLabel = gridDist.toFixed(2)
      }

      setDrawingState(prev => ({
        ...prev,
        currentPoint: e.point.clone(),
        currentFace: faceIndex,
        currentUV: e.uv.clone(),
        distLabel: distLabel
      }))

      if (tool === 'eraser' && faceIndex === drawingState.currentFace) {
         // We accumulate eraser strokes in a "live" way, but ideally we'd add to history on Up
         // For simplicity, visual feedback here, logic on Up
         paintDot(faceIndex, e.uv.x, e.uv.y, '#e0e0e0', 0.08)
      }
    }
  }

  const handlePointerUp = () => {
    if (mode === 'draw' && drawingState.isDrawing) {
      const { startFace, currentFace, startUV, currentUV, distLabel } = drawingState

      if (startFace !== null && currentFace !== null && startUV && currentUV) {
         let activeMap = unfoldedFaces
         if (Object.keys(activeMap).length === 0 || !activeMap[startFace]) {
             activeMap = generateVirtualMap(startFace)
         }

         const startState = activeMap[startFace]
         const endState = activeMap[currentFace]

         if (startState && endState) {
             const globalStart = localUVToGlobal(startUV, startState)
             const globalEnd = localUVToGlobal(currentUV, endState)

             const dx = globalEnd.x - globalStart.x
             const dy = globalEnd.y - globalStart.y
             const dist = Math.sqrt(dx*dx + dy*dy)
             
             const stepSize = 0.005 
             const steps = Math.min(Math.ceil(dist / stepSize), 2000) 
             
             const paths = {}
             
             // Midpoint for Scale
             const midT = 0.5
             const midX = globalStart.x + dx * midT
             const midY = globalStart.y + dy * midT
             let textStamped = false

             if (steps > 0) {
                 for (let i = 0; i <= steps; i++) {
                     const t = i / steps
                     const gx = globalStart.x + dx * t
                     const gy = globalStart.y + dy * t
                     
                     for (const fidStr of Object.keys(activeMap)) {
                         const fid = parseInt(fidStr)
                         const fState = activeMap[fid]
                         
                         if (gx >= fState.x - 0.501 && gx <= fState.x + 0.501 &&
                             gy >= fState.y - 0.501 && gy <= fState.y + 0.501) {
                             
                             const localUV = globalToLocalUV({x: gx, y: gy}, fState)
                             if (!paths[fid]) paths[fid] = []
                             paths[fid].push(localUV)

                             if (tool === 'scale' && !textStamped) {
                                 const dMid = Math.sqrt((gx-midX)**2 + (gy-midY)**2)
                                 if (dMid < 0.02) {
                                     onAddMeasurement({faceId: fid, u: localUV.x, v: localUV.y, text: distLabel})
                                     textStamped = true
                                 }
                             }
                             break; 
                         }
                     }
                 }
                 // Add the stroke to history (for both Pen and Scale)
                 // Scale draws a yellow line, Pen draws selected color
                 const lineColor = tool === 'scale' ? '#ffeb3b' : color
                 if (tool !== 'eraser') {
                    onAddDrawing({ paths, color: lineColor, tool })
                 }
             }
         }
      }
    }
    setDrawingState(prev => ({ ...prev, isDrawing: false, startPoint: null, currentPoint: null }))
  }

  const handleUnfoldNeighbor = (parentFaceId, edgeIdx) => {
    const parentState = unfoldedFaces[parentFaceId]
    const connection = CUBE_ADJACENCY[parentFaceId][edgeIdx]
    const neighborId = connection.face
    const neighborEntryEdge = connection.edge
    const localVectors = [{ x: 0, y: 1 }, { x: 0, y: -1 }, { x: -1, y: 0 }, { x: 1, y: 0 }]
    const parentRot = parentState.rot
    const exitVectorLocal = localVectors[edgeIdx]
    const cos = Math.cos(parentRot)
    const sin = Math.sin(parentRot)
    const gridMoveX = Math.round(exitVectorLocal.x * cos - exitVectorLocal.y * sin)
    const gridMoveY = Math.round(exitVectorLocal.x * sin + exitVectorLocal.y * cos)
    const newX = parentState.x + gridMoveX
    const newY = parentState.y + gridMoveY
    const entryVectorLocal = localVectors[neighborEntryEdge]
    const entryAngleLocal = Math.atan2(entryVectorLocal.y, entryVectorLocal.x)
    const targetAngleGlobal = Math.atan2(-gridMoveY, -gridMoveX)
    let newRot = targetAngleGlobal - entryAngleLocal
    const PI_2 = Math.PI / 2
    newRot = Math.round(newRot / PI_2) * PI_2
    setUnfoldedFaces(prev => ({...prev, [neighborId]: { x: newX, y: newY, rot: newRot }}))
  }

  return (
    <group>
      {FACES.map((face) => {
        const isUnfolded = !!unfoldedFaces[face.id]
        let availableNeighbors = null
        if (isUnfolded && mode === 'open') {
          availableNeighbors = CUBE_ADJACENCY[face.id].map(conn => {
            if (unfoldedFaces[conn.face]) return null
            return conn
          })
        }
        return (
          <FaceMesh
            key={face.id}
            face={face}
            material={materials[face.id]}
            unfoldedState={unfoldedFaces[face.id]}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onUnfoldNeighbor={handleUnfoldNeighbor}
            availableNeighbors={availableNeighbors}
            mode={mode}
            gridN={gridN}
            registerMesh={registerMesh}
          />
        )
      })}
      
      {/* Preview Line */}
      {drawingState.isDrawing && drawingState.startPoint && drawingState.currentPoint && (tool === 'pen' || tool === 'scale') && (
        <group>
            <Line 
            points={[drawingState.startPoint, drawingState.currentPoint]} 
            color={tool === 'scale' ? '#ffeb3b' : '#00ffff'} 
            lineWidth={3} 
            transparent
            opacity={0.8}
            dashed={tool === 'scale'}
            dashScale={10}
            />
            {tool === 'scale' && (
                <Text 
                    position={new THREE.Vector3().lerpVectors(drawingState.startPoint, drawingState.currentPoint, 0.5).add(new THREE.Vector3(0, 0.2, 0))}
                    fontSize={0.5}
                    color="white"
                    outlineWidth={0.05}
                    outlineColor="black"
                >
                    {drawingState.distLabel}
                </Text>
            )}
        </group>
      )}
    </group>
  )
}

function App() {
  const [mode, setMode] = useState('view')
  const [color, setColor] = useState('#000000')
  const [tool, setTool] = useState('pen')
  const [resetCount, setResetCount] = useState(0)
  const [gridN, setGridN] = useState(3)
  
  // History State
  const [drawings, setDrawings] = useState([])
  const [measurements, setMeasurements] = useState([])

  const getCursorClass = () => {
    if (mode === 'open') return 'cursor-open'
    if (mode === 'view') return 'cursor-view'
    if (tool === 'eraser') return 'cursor-eraser'
    if (tool === 'scale') return 'cursor-crosshair'
    return 'cursor-pen'
  }

  const handleAddDrawing = (drawing) => {
    setDrawings(prev => [...prev, drawing])
  }

  const handleAddMeasurement = (measurement) => {
    setMeasurements(prev => [...prev, measurement])
  }

  return (
    <div className={`canvas-container ${getCursorClass()}`} onContextMenu={(e) => e.preventDefault()}>
      <h1 className="title-text">Code of the Day 2025</h1>
      <div className="palette">
        <div className="palette-section">
          <span className="palette-label">Mode</span>
          <div className="mode-switch">
            <button className={`mode-btn ${mode === 'view' ? 'active' : ''}`} onClick={() => setMode('view')}>View</button>
            <button className={`mode-btn ${mode === 'draw' ? 'active' : ''}`} onClick={() => setMode('draw')}>Draw</button>
            <button className={`mode-btn ${mode === 'open' ? 'active' : ''}`} onClick={() => setMode('open')}>Open</button>
          </div>
        </div>
        
        {mode === 'view' && (
          <div className="palette-section">
             <span className="palette-label">Grid Size (N={gridN})</span>
             <input type="range" min="1" max="10" step="1" value={gridN} onChange={(e) => setGridN(parseInt(e.target.value))} style={{width: '100%', cursor: 'pointer'}}/>
          </div>
        )}

        {mode === 'draw' && (
          <>
            <div className="palette-section">
              <span className="palette-label">Tool</span>
              <button className={`tool-btn ${tool === 'pen' ? 'active' : ''}`} onClick={() => setTool('pen')}>✏️ Pen</button>
              <button className={`tool-btn ${tool === 'scale' ? 'active' : ''}`} onClick={() => setTool('scale')}>📏 Scale</button>
              <button className={`tool-btn ${tool === 'eraser' ? 'active' : ''}`} onClick={() => setTool('eraser')}>🧹 Eraser</button>
            </div>
            
            {tool === 'pen' && (
                <div className="palette-section">
                <span className="palette-label">Color</span>
                <div className="color-options">
                    {COLORS.map((c) => (
                    <button key={c.name} className={`color-btn ${color === c.value ? 'active' : ''}`} style={{ backgroundColor: c.value }} onClick={() => setColor(c.value)} title={c.name}/>
                    ))}
                </div>
                </div>
            )}

            <div className="palette-section">
              <span className="palette-label">Clear</span>
              <div style={{display: 'flex', gap: '5px'}}>
                <button className="tool-btn" style={{flex:1, fontSize:'0.7rem'}} onClick={() => setDrawings([])}>Drawings</button>
                <button className="tool-btn" style={{flex:1, fontSize:'0.7rem'}} onClick={() => setMeasurements([])}>Measures</button>
              </div>
            </div>

            <p style={{fontSize: '0.8rem', color: '#aaa', margin: '5px 0 0 0'}}>
              <b>Left Click:</b> {tool === 'eraser' ? 'Freehand' : 'Drag Line'}<br/>
              <b>Right Click:</b> Rotate
            </p>
          </>
        )}

        {mode === 'open' && (
           <div className="palette-section">
             <span className="palette-label">Actions</span>
             <button className="tool-btn" style={{background: '#ff5722'}} onClick={() => setResetCount(c => c + 1)}>↻ Reset Net</button>
             <p style={{fontSize: '0.8rem', color: '#aaa', marginTop: '5px'}}>1. Click a face to anchor it.<br/>2. Click "+" to peel neighbors.</p>
           </div>
        )}
      </div>

      <div className="footer-text" style={{left: 'auto', right: '20px', bottom: '20px'}}>Made with ❤️ by Team CC</div>
      
      <Canvas camera={{ position: [6, 6, 6], fov: 45 }}>
        <ambientLight intensity={0.7} />
        <pointLight position={[10, 10, 10]} intensity={1} />
        <pointLight position={[-10, -10, -10]} intensity={0.5} />
        <UnfoldingCube 
            mode={mode} color={color} tool={tool} resetTrigger={resetCount} gridN={gridN}
            drawings={drawings} measurements={measurements}
            onAddDrawing={handleAddDrawing} onAddMeasurement={handleAddMeasurement}
        />
        <OrbitControls enabled={true} enableDamping={true} mouseButtons={{LEFT: mode === 'draw' ? null : THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE}} touches={{ONE: mode === 'draw' ? null : THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN}}/>
      </Canvas>
    </div>
  )
}

export default App
import React, { useRef, useState, useEffect, useMemo } from 'react'
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

// Face definitions with initial 3D transforms
// 0: Front, 1: Back, 2: Right, 3: Left, 4: Top, 5: Bottom
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
  0: [ // Front
    { face: 4, edge: 1 }, // Top -> Top Face (Bottom Edge)
    { face: 5, edge: 0 }, // Bottom -> Bottom Face (Top Edge)
    { face: 3, edge: 3 }, // Left -> Left Face (Right Edge)
    { face: 2, edge: 2 }  // Right -> Right Face (Left Edge)
  ],
  1: [ // Back
    { face: 4, edge: 0 }, // Top -> Top Face (Top Edge)
    { face: 5, edge: 1 }, // Bottom -> Bottom Face (Bottom Edge)
    { face: 2, edge: 3 }, // Left -> Right Face (Right Edge)
    { face: 3, edge: 2 }  // Right -> Left Face (Left Edge)
  ],
  2: [ // Right
    { face: 4, edge: 3 }, // Top -> Top Face (Right Edge)
    { face: 5, edge: 3 }, // Bottom -> Bottom Face (Right Edge)
    { face: 0, edge: 3 }, // Left -> Front Face (Right Edge)
    { face: 1, edge: 2 }  // Right -> Back Face (Left Edge)
  ],
  3: [ // Left
    { face: 4, edge: 2 }, // Top -> Top Face (Left Edge)
    { face: 5, edge: 2 }, // Bottom -> Bottom Face (Left Edge)
    { face: 1, edge: 3 }, // Left -> Back Face (Right Edge)
    { face: 0, edge: 2 }  // Right -> Front Face (Left Edge)
  ],
  4: [ // Top
    { face: 1, edge: 0 }, // Top -> Back Face (Top Edge)
    { face: 0, edge: 0 }, // Bottom -> Front Face (Top Edge)
    { face: 3, edge: 0 }, // Left -> Left Face (Top Edge)
    { face: 2, edge: 0 }  // Right -> Right Face (Top Edge)
  ],
  5: [ // Bottom
    { face: 0, edge: 1 }, // Top -> Front Face (Bottom Edge)
    { face: 1, edge: 1 }, // Bottom -> Back Face (Bottom Edge)
    { face: 3, edge: 1 }, // Left -> Left Face (Bottom Edge)
    { face: 2, edge: 1 }  // Right -> Right Face (Bottom Edge)
  ]
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

function FaceMesh({ 
  face, 
  material, 
  unfoldedState, // { x, y, rot } or null
  onPointerDown, 
  onPointerMove, 
  onPointerUp,
  onUnfoldNeighbor,
  availableNeighbors,
  mode
}) {
  const meshRef = useRef()
  const FACE_SIZE = 2.5
  
  useFrame(() => {
    if (!meshRef.current) return

    let targetPos, targetRot

    if (unfoldedState) {
      // Unfolded position (2D grid). We use a gap of 2.6 for visibility
      const GRID_STEP = 2.55 
      targetPos = new THREE.Vector3(unfoldedState.x * GRID_STEP, unfoldedState.y * GRID_STEP, 0)
      targetRot = new THREE.Euler(0, 0, unfoldedState.rot)
    } else {
      // Folded position (3D cube)
      targetPos = new THREE.Vector3(...face.pos)
      targetRot = new THREE.Euler(...face.rot)
    }

    // Smooth animation
    meshRef.current.position.lerp(targetPos, 0.1)
    
    // Quaternion slerp for smooth rotation
    const targetQ = new THREE.Quaternion().setFromEuler(targetRot)
    meshRef.current.quaternion.slerp(targetQ, 0.1)
  })

  // Hinge positions relative to the face center (UV space)
  const hingePositions = [
    [0, 1.25, 0],   // 0: Top
    [0, -1.25, 0],  // 1: Bottom
    [-1.25, 0, 0],  // 2: Left
    [1.25, 0, 0]    // 3: Right
  ]

  // Hover effect for the face itself
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
        
        {/* Selection Highlight for Open Mode (Anchor suggestion) */}
        {faceHovered && mode === 'open' && !unfoldedState && (
           <mesh position={[0,0,-0.01]}>
              <planeGeometry args={[FACE_SIZE * 1.05, FACE_SIZE * 1.05]} />
              <meshBasicMaterial color="#00ffff" transparent opacity={0.3} />
           </mesh>
        )}

        <Text 
          position={[0, 0, 0.01]} 
          rotation={face.textRot} 
          fontSize={1.2} 
          color="black" 
          anchorX="center" 
          anchorY="middle"
        >
          {face.text}
        </Text>

        {/* Render Hinges for Unfolded Neighbors */}
        {unfoldedState && availableNeighbors && availableNeighbors.map((conn, idx) => {
          if (!conn) return null // Neighbor already unfolded or invalid
          
          return (
            <HingeButton 
              key={idx} 
              position={hingePositions[idx]} 
              rotation={[0, 0, 0]}
              onClick={() => onUnfoldNeighbor(face.id, idx)} 
            />
          )
        })}
      </mesh>
    </group>
  )
}

function UnfoldingCube({ mode, color, tool, resetTrigger }) {
  // unfoldedFaces: Map<faceId, { x, y, rot }>
  const [unfoldedFaces, setUnfoldedFaces] = useState({})
  
  // Drawing state
  const [drawingState, setDrawingState] = useState({ 
    isDrawing: false, 
    startUV: null, 
    lastUV: null,
    faceIndex: null,
    startPoint: null,
    currentPoint: null,
    isValidHover: false // Track if we are hovering the correct face
  })

  // Reset when trigger changes
  useEffect(() => {
    setUnfoldedFaces({})
  }, [resetTrigger])
  
  // Create canvases for drawing (persistent across renders)
  const { canvases, textures, materials } = useMemo(() => {
    const canvases = []
    const textures = []
    const materials = []
    
    for (let i = 0; i < 6; i++) {
      const canvas = document.createElement('canvas')
      canvas.width = 512
      canvas.height = 512
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#e0e0e0' // Light grey paper color
      ctx.fillRect(0, 0, 512, 512)
      
      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      
      canvases.push(canvas)
      textures.push(texture)
      
      materials.push(new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.6,
        metalness: 0.1,
        side: THREE.DoubleSide 
      }))
    }
    return { canvases, textures, materials }
  }, [])

  const handlePointerDown = (e, faceIndex) => {
    e.stopPropagation()
    
    // Mode: Open - Logic for Anchoring the Net
    if (mode === 'open') {
      if (Object.keys(unfoldedFaces).length === 0) {
        setUnfoldedFaces({ [faceIndex]: { x: 0, y: 0, rot: 0 } })
      }
      return
    }

    // Mode: Draw
    if (mode === 'draw') {
      setDrawingState({
        isDrawing: true,
        startUV: e.uv.clone(),
        lastUV: e.uv.clone(),
        faceIndex: faceIndex,
        startPoint: e.point.clone(),
        currentPoint: e.point.clone(),
        isValidHover: true
      })
    }
  }

  // The Core Logic: Calculating where a neighbor should land on the 2D grid
  const handleUnfoldNeighbor = (parentFaceId, edgeIdx) => {
    const parentState = unfoldedFaces[parentFaceId]
    const connection = CUBE_ADJACENCY[parentFaceId][edgeIdx]
    const neighborId = connection.face
    const neighborEntryEdge = connection.edge

    // 1. Determine Grid Move Vector
    const localVectors = [
      { x: 0, y: 1 },  // 0: Top
      { x: 0, y: -1 }, // 1: Bottom
      { x: -1, y: 0 }, // 2: Left
      { x: 1, y: 0 }   // 3: Right
    ]
    
    const parentRot = parentState.rot
    const exitVectorLocal = localVectors[edgeIdx]

    // Rotate local vector by parent's current rotation to get Global Grid Move
    const cos = Math.cos(parentRot)
    const sin = Math.sin(parentRot)
    const gridMoveX = Math.round(exitVectorLocal.x * cos - exitVectorLocal.y * sin)
    const gridMoveY = Math.round(exitVectorLocal.x * sin + exitVectorLocal.y * cos)

    // New Grid Position
    const newX = parentState.x + gridMoveX
    const newY = parentState.y + gridMoveY

    // 2. Determine New Rotation
    const entryVectorLocal = localVectors[neighborEntryEdge]
    const entryAngleLocal = Math.atan2(entryVectorLocal.y, entryVectorLocal.x)
    const targetAngleGlobal = Math.atan2(-gridMoveY, -gridMoveX)
    
    let newRot = targetAngleGlobal - entryAngleLocal

    const PI_2 = Math.PI / 2
    newRot = Math.round(newRot / PI_2) * PI_2

    setUnfoldedFaces(prev => ({
      ...prev,
      [neighborId]: { x: newX, y: newY, rot: newRot }
    }))
  }

  const handlePointerMove = (e, faceIndex) => {
    if (mode === 'draw' && drawingState.isDrawing) {
      e.stopPropagation()

      // Line Restriction Logic:
      // Only draw/erase if we are still on the SAME face we started on
      if (faceIndex !== drawingState.faceIndex) {
         setDrawingState(prev => ({ ...prev, isValidHover: false }))
         return
      }

      // If we are on the correct face, proceed
      if (tool === 'eraser') {
         if (e.uv) {
             const canvas = canvases[faceIndex]
             const ctx = canvas.getContext('2d')
             const texture = textures[faceIndex]
             
             const startX = drawingState.lastUV.x * canvas.width
             const startY = (1 - drawingState.lastUV.y) * canvas.height
             const endX = e.uv.x * canvas.width
             const endY = (1 - e.uv.y) * canvas.height
             
             ctx.beginPath()
             ctx.moveTo(startX, startY)
             ctx.lineTo(endX, endY)
             ctx.lineCap = 'round'
             ctx.lineWidth = 50 // Slightly thicker for eraser
             ctx.strokeStyle = '#e0e0e0' // Paint over with paper color
             ctx.stroke()
             
             texture.needsUpdate = true
             
             setDrawingState(prev => ({
                 ...prev,
                 lastUV: e.uv.clone(),
                 currentPoint: e.point.clone(),
                 isValidHover: true
             }))
         }
      } else {
          // Pen tool: Just update current point for preview
          setDrawingState(prev => ({
            ...prev,
            currentPoint: e.point.clone(),
            isValidHover: true
          }))
      }
    }
  }

  const handlePointerUp = (e, faceIndex) => {
    if (mode !== 'draw' || !drawingState.isDrawing) return
    e.stopPropagation()
    
    if (tool === 'pen') {
        const endUV = e.uv
        
        // Only commit the line if we ended on the same face we started
        if (faceIndex === drawingState.faceIndex && endUV) {
          const canvas = canvases[faceIndex]
          const ctx = canvas.getContext('2d')
          const texture = textures[faceIndex]
          
          const startX = drawingState.startUV.x * canvas.width
          const startY = (1 - drawingState.startUV.y) * canvas.height 
          const endX = endUV.x * canvas.width
          const endY = (1 - endUV.y) * canvas.height
          
          ctx.beginPath()
          ctx.moveTo(startX, startY)
          ctx.lineTo(endX, endY)
          ctx.lineCap = 'round'
          ctx.lineWidth = 10
          ctx.strokeStyle = color
          ctx.stroke()
          
          texture.needsUpdate = true
        }
    }
    
    setDrawingState({ 
      isDrawing: false, 
      startUV: null, 
      lastUV: null,
      faceIndex: null,
      startPoint: null,
      currentPoint: null,
      isValidHover: false
    })
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
          />
        )
      })}

      {/* Preview Line - Only render if isValidHover is true (we are on the correct face) */}
      {drawingState.isDrawing && drawingState.startPoint && drawingState.currentPoint && drawingState.isValidHover && tool === 'pen' && (
        <Line 
          points={[drawingState.startPoint, drawingState.currentPoint]} 
          color={color} 
          lineWidth={3} 
        />
      )}
    </group>
  )
}

function App() {
  const [mode, setMode] = useState('view') // 'view', 'draw', 'open'
  const [color, setColor] = useState('#000000')
  const [tool, setTool] = useState('pen') // 'pen' or 'eraser'
  const [resetCount, setResetCount] = useState(0) // Used to trigger reset

  const getCursorClass = () => {
    if (mode === 'open') return 'cursor-open'
    if (mode === 'view') return 'cursor-view'
    if (tool === 'eraser') return 'cursor-eraser'
    return 'cursor-pen'
  }

  return (
    <div className={`canvas-container ${getCursorClass()}`}>
      <h1 className="title-text">Code of the Day 2025</h1>
      
      <div className="palette">
        <div className="palette-section">
          <span className="palette-label">Mode</span>
          <div className="mode-switch">
            <button 
              className={`mode-btn ${mode === 'view' ? 'active' : ''}`}
              onClick={() => setMode('view')}
            >
              View
            </button>
            <button 
              className={`mode-btn ${mode === 'draw' ? 'active' : ''}`}
              onClick={() => setMode('draw')}
            >
              Draw
            </button>
            <button 
              className={`mode-btn ${mode === 'open' ? 'active' : ''}`}
              onClick={() => setMode('open')}
            >
              Open
            </button>
          </div>
        </div>

        {mode === 'draw' && (
          <>
            <div className="palette-section">
              <span className="palette-label">Tool</span>
              <button 
                className={`tool-btn ${tool === 'pen' ? 'active' : ''}`}
                onClick={() => setTool('pen')}
              >
                ✏️ Pen
              </button>
              <button 
                className={`tool-btn ${tool === 'eraser' ? 'active' : ''}`}
                onClick={() => setTool('eraser')}
              >
                🧹 Eraser
              </button>
            </div>

            <div className="palette-section">
              <span className="palette-label">Color</span>
              <div className="color-options">
                {COLORS.map((c) => (
                  <button
                    key={c.name}
                    className={`color-btn ${color === c.value ? 'active' : ''}`}
                    style={{ backgroundColor: c.value }}
                    onClick={() => setColor(c.value)}
                    title={c.name}
                  />
                ))}
              </div>
            </div>
          </>
        )}

        {mode === 'open' && (
           <div className="palette-section">
             <span className="palette-label">Actions</span>
             <button 
                className="tool-btn"
                style={{background: '#ff5722'}}
                onClick={() => setResetCount(c => c + 1)}
              >
                ↻ Reset Net
              </button>
              <p style={{fontSize: '0.8rem', color: '#aaa', marginTop: '5px'}}>
                1. Click a face to anchor it.<br/>
                2. Click "+" to peel neighbors.
              </p>
           </div>
        )}
      </div>

      <div 
        className="footer-text" 
        style={{
          left: 'auto',
          right: '20px',
          bottom: '20px'
        }}
      >
        Made with ❤️ by Team CC
      </div>
      
      <Canvas camera={{ position: [6, 6, 6], fov: 45 }}>
        <ambientLight intensity={0.7} />
        <pointLight position={[10, 10, 10]} intensity={1} />
        <pointLight position={[-10, -10, -10]} intensity={0.5} />
        <UnfoldingCube mode={mode} color={color} tool={tool} resetTrigger={resetCount} />
        <OrbitControls enabled={mode === 'view' || mode === 'open'} enableDamping={true} />
      </Canvas>
    </div>
  )
}

export default App
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

// Face definitions with initial transforms
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
// [Top, Bottom, Left, Right] (relative to the face's UV)
// Each entry: { face: ID, edge: EdgeIndexOnNeighbor }
// Edge Indices: 0=Top, 1=Bottom, 2=Left, 3=Right
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
    { face: 2, edge: 3 }, // Left -> Right Face (Right Edge) - Viewed from back, Left is Right Face
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
        position={[0, 0, 0.02]}
        onClick={(e) => { e.stopPropagation(); onClick() }}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <circleGeometry args={[0.3, 32]} />
        <meshBasicMaterial color={hovered ? "#00bcd4" : "#ffffff"} transparent opacity={0.8} side={THREE.DoubleSide} />
        <Text position={[0, 0, 0.01]} fontSize={0.3} color="black" anchorX="center" anchorY="middle">+</Text>
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
  availableNeighbors
}) {
  const meshRef = useRef()
  
  useFrame(() => {
    if (!meshRef.current) return

    let targetPos, targetRot

    if (unfoldedState) {
      // Unfolded position (2D grid)
      // Grid unit is 2.5 (face size) + gap? Let's use 2.6 for slight gap or 2.5 for tight
      const SIZE = 2.5
      targetPos = new THREE.Vector3(unfoldedState.x * SIZE, unfoldedState.y * SIZE, 0)
      targetRot = new THREE.Euler(0, 0, unfoldedState.rot)
    } else {
      // Folded position (3D cube)
      targetPos = new THREE.Vector3(...face.pos)
      targetRot = new THREE.Euler(...face.rot)
    }

    // Lerp for animation
    meshRef.current.position.lerp(targetPos, 0.1)
    
    // Slerp for rotation
    const targetQ = new THREE.Quaternion().setFromEuler(targetRot)
    meshRef.current.quaternion.slerp(targetQ, 0.1)
  })

  // Calculate hinge button positions
  // 0: Top (0, 1.25), 1: Bottom (0, -1.25), 2: Left (-1.25, 0), 3: Right (1.25, 0)
  const hingePositions = [
    [0, 1.25, 0],
    [0, -1.25, 0],
    [-1.25, 0, 0],
    [1.25, 0, 0]
  ]

  return (
    <group>
      <mesh
        ref={meshRef}
        material={material}
        onPointerDown={(e) => onPointerDown(e, face.id)}
        onPointerMove={(e) => onPointerMove(e, face.id)}
        onPointerUp={(e) => onPointerUp(e, face.id)}
      >
        <planeGeometry args={[2.5, 2.5]} />
        <Edges 
          linewidth={4} 
          scale={1.0} 
          threshold={15} 
          color="black" 
          raycast={() => null}
        />
        <Text 
          position={[0, 0, 0.01]} 
          rotation={face.textRot} 
          fontSize={1.5} 
          color="black" 
          anchorX="center" 
          anchorY="middle" 
          raycast={() => null}
        >
          {face.text}
        </Text>

        {/* Hinge Buttons - Only show if unfolded and neighbor is available */}
        {unfoldedState && availableNeighbors && availableNeighbors.map((neighbor, idx) => {
          if (!neighbor) return null
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

function UnfoldingCube({ mode, color, tool }) {
  // unfoldedFaces: Map<faceId, { x, y, rot }>
  const [unfoldedFaces, setUnfoldedFaces] = useState({})
  
  const [drawingState, setDrawingState] = useState({ 
    isDrawing: false, 
    startUV: null, 
    lastUV: null,
    faceIndex: null,
    startPoint: null,
    currentPoint: null
  })
  
  // Create 6 canvases and textures
  const { canvases, textures, materials } = useMemo(() => {
    const canvases = []
    const textures = []
    const materials = []
    
    for (let i = 0; i < 6; i++) {
      const canvas = document.createElement('canvas')
      canvas.width = 512
      canvas.height = 512
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#d2b48c'
      ctx.fillRect(0, 0, 512, 512)
      
      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      
      canvases.push(canvas)
      textures.push(texture)
      
      materials.push(new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.5,
        metalness: 0.0,
        side: THREE.DoubleSide 
      }))
    }
    
    return { canvases, textures, materials }
  }, [])

  const handlePointerDown = (e, faceIndex) => {
    e.stopPropagation()
    
    if (mode === 'open') {
      // If clicking a folded face, start unfolding from there (reset)
      if (!unfoldedFaces[faceIndex]) {
        setUnfoldedFaces({ [faceIndex]: { x: 0, y: 0, rot: 0 } })
      } else {
        // If clicking an unfolded face (Anchor?), maybe refold?
        // For now, let's just keep it simple. Click outside to reset?
        // Or click the anchor to reset.
        if (unfoldedFaces[faceIndex].x === 0 && unfoldedFaces[faceIndex].y === 0) {
           setUnfoldedFaces({}) // Reset
        }
      }
      return
    }

    if (mode !== 'draw') return
    
    setDrawingState({
      isDrawing: true,
      startUV: e.uv.clone(),
      lastUV: e.uv.clone(),
      faceIndex: faceIndex,
      startPoint: e.point.clone(),
      currentPoint: e.point.clone()
    })
  }

  const handleUnfoldNeighbor = (parentFaceId, edgeIdx) => {
    const parentState = unfoldedFaces[parentFaceId]
    const connection = CUBE_ADJACENCY[parentFaceId][edgeIdx]
    const neighborId = connection.face
    
    // Calculate new position and rotation
    // edgeIdx: 0=Top, 1=Bottom, 2=Left, 3=Right (relative to parent)
    
    // We need to account for parent's current rotation in the grid
    // 0 rad = Up is Up.
    // If parent is rotated 90 deg (PI/2), its "Top" is visually Left.
    
    // Convert rotation to discrete steps (0, 1, 2, 3) representing 0, 90, 180, 270
    const rotSteps = Math.round(parentState.rot / (Math.PI / 2)) % 4
    
    // Adjust edgeIdx by rotation to get "Visual Direction" in grid
    // If rot is 90 (1 step), Top(0) becomes Left(2).
    // Mapping: 0->2, 1->3, 2->1, 3->0 ? No.
    // Rot +90 (CCW):
    // Top (0,1) -> Left (-1,0).
    // Left (-1,0) -> Bottom (0,-1).
    // Bottom (0,-1) -> Right (1,0).
    // Right (1,0) -> Top (0,1).
    
    // Let's use vectors for grid movement
    const moves = [
      { x: 0, y: 1 },  // 0: Top
      { x: 0, y: -1 }, // 1: Bottom
      { x: -1, y: 0 }, // 2: Left
      { x: 1, y: 0 }   // 3: Right
    ]
    
    // Apply rotation to the move vector
    const move = moves[edgeIdx]
    const cos = Math.round(Math.cos(parentState.rot))
    const sin = Math.round(Math.sin(parentState.rot))
    const dx = move.x * cos - move.y * sin
    const dy = move.x * sin + move.y * cos
    
    const newX = parentState.x + dx
    const newY = parentState.y + dy
    
    // Calculate new rotation
    // We need the neighbor's "entry edge" to align with parent's "exit edge"
    // Exit edge is edgeIdx.
    // Entry edge is connection.edge.
    // Standard alignment: If I exit Top, I enter Bottom.
    // If I exit Top (0), and enter Bottom (1), rotation is 0.
    // If I exit Top (0), and enter Left (2), rotation must change.
    
    // Let's define "Standard Entry" for each Exit:
    // Exit 0 (Top) -> Expect Entry 1 (Bottom)
    // Exit 1 (Bottom) -> Expect Entry 0 (Top)
    // Exit 2 (Left) -> Expect Entry 3 (Right)
    // Exit 3 (Right) -> Expect Entry 2 (Left)
    
    const expectedEntry = { 0: 1, 1: 0, 2: 3, 3: 2 }
    const actualEntry = connection.edge
    
    // Calculate rotation diff
    // 0=Top, 2=Left, 1=Bottom, 3=Right (CCW order: 3, 0, 2, 1... wait)
    // Let's use standard angle: 0=Top, 1=Left, 2=Bottom, 3=Right (CCW)
    // My edgeIdx: 0=Top, 2=Left, 1=Bottom, 3=Right.
    // Let's map edgeIdx to Angle Index:
    const edgeToAngle = { 0: 0, 2: 1, 1: 2, 3: 3 } // 0->90->180->270
    
    const exitAngle = edgeToAngle[edgeIdx]
    const entryAngle = edgeToAngle[actualEntry]
    const expectedEntryAngle = edgeToAngle[expectedEntry[edgeIdx]]
    
    // The rotation needed is the difference between expected entry and actual entry
    // If I expect Bottom (2) but get Left (1), I need to rotate neighbor so Left becomes Bottom.
    // Rotate +90 (1 step).
    
    const rotDiff = (expectedEntryAngle - entryAngle) * (Math.PI / 2)
    const newRot = parentState.rot + rotDiff
    
    setUnfoldedFaces(prev => ({
      ...prev,
      [neighborId]: { x: newX, y: newY, rot: newRot }
    }))
  }

  const handlePointerMove = (e, faceIndex) => {
    if (mode === 'draw' && drawingState.isDrawing) {
      e.stopPropagation()
      
      if (tool === 'eraser') {
         if (faceIndex === drawingState.faceIndex && e.uv) {
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
             ctx.lineWidth = 30
             ctx.strokeStyle = '#d2b48c'
             ctx.stroke()
             
             texture.needsUpdate = true
             
             setDrawingState(prev => ({
                 ...prev,
                 lastUV: e.uv.clone(),
                 currentPoint: e.point.clone()
             }))
         }
      } else {
          setDrawingState(prev => ({
            ...prev,
            currentPoint: e.point.clone()
          }))
      }
    }
  }

  const handlePointerUp = (e, faceIndex) => {
    if (mode !== 'draw' || !drawingState.isDrawing) return
    e.stopPropagation()
    
    if (tool === 'pen') {
        const endUV = e.uv
        
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
          ctx.lineWidth = 8
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
      currentPoint: null
    })
  }

  return (
    <group>
      {FACES.map((face) => {
        const isUnfolded = !!unfoldedFaces[face.id]
        
        // Determine available neighbors for hinge buttons
        let availableNeighbors = null
        if (isUnfolded && mode === 'open') {
          availableNeighbors = CUBE_ADJACENCY[face.id].map(conn => {
            // If neighbor is already unfolded, don't show button
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
          />
        )
      })}

      {/* Preview Line - Only for Pen tool */}
      {drawingState.isDrawing && drawingState.startPoint && drawingState.currentPoint && tool === 'pen' && (
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

  const getCursorClass = () => {
    if (mode === 'open') return 'cursor-open'
    if (mode === 'view') return 'cursor-view'
    if (tool === 'eraser') return 'cursor-eraser'
    return 'cursor-pen'
  }

  return (
    <div className={`canvas-container ${getCursorClass()}`}>
      <h1 className="title-text">Code of The Day</h1>
      
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
      </div>

      <div className="footer-text">Made with ❤️ by team CC</div>
      
      <Canvas camera={{ position: [5, 5, 5], fov: 50 }}>
        <ambientLight intensity={0.7} />
        <pointLight position={[10, 10, 10]} intensity={1} />
        <pointLight position={[-10, -10, -10]} intensity={0.5} />
        <UnfoldingCube mode={mode} color={color} tool={tool} />
        <OrbitControls enabled={mode === 'view'} enableDamping={true} />
      </Canvas>
    </div>
  )
}

export default App

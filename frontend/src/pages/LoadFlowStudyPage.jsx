import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  ConnectionLineType,
  Controls,
  MiniMap,
  SelectionMode,
  addEdge,
  reconnectEdge,
  useEdgesState,
  useNodesState
} from 'reactflow';
import 'reactflow/dist/style.css';
import axios from 'axios';
import Palette from '../components/Palette';
import ControlPanel from '../components/ControlPanel';
import {
  BusNode,
  GeneratorNode,
  LoadNode,
  ResistiveLoadNode,
  TransformerNode,
  UtilityNode
} from '../components/SymbolNodes';

const API_BASE = 'http://127.0.0.1:8000';

const defaultDataByType = {
  bus: (index) => ({ label: `Bus ${index}`, vn_kv: 11 }),
  load: (index) => ({ label: `Motor ${index}`, p_mw: 1.5, q_mvar: 0.7 }),
  resistive_load: (index) => ({ label: `Resistive ${index}`, p_mw: 1.2, q_mvar: 0.0 }),
  generator: (index) => ({ label: `Gen ${index}`, p_mw: 1.0, vm_pu: 1.0 }),
  utility: (index) => ({ label: `Utility ${index}`, p_mw: 0.0, vm_pu: 1.0 }),
  transformer: (index) => ({ label: `TX ${index}`, hv_kv: 33, lv_kv: 11 })
};

export default function LoadFlowStudyPage({ studyType = 'loadflow' }) {
  const reactFlowWrapper = useRef(null);
  const historyRef = useRef([]);
  const futureRef = useRef([]);
  const isRestoringHistoryRef = useRef(false);
  const lastSnapshotRef = useRef('');
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [rfInstance, setRfInstance] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedNodes, setSelectedNodes] = useState([]);
  const [selectedEdges, setSelectedEdges] = useState([]);
  const [clipboard, setClipboard] = useState({ nodes: [], edges: [] });
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [showRatings, setShowRatings] = useState(false);
  const [shortCircuitFaultType, setShortCircuitFaultType] = useState('three_phase');
  const [shortCircuitFaultBusId, setShortCircuitFaultBusId] = useState('');
  const [contextMenu, setContextMenu] = useState(null);
  const nodeTypes = useMemo(
    () => ({
      bus: (props) => <BusNode {...props} showRating={showRatings} />,
      load: (props) => <LoadNode {...props} showRating={showRatings} />,
      resistive_load: (props) => <ResistiveLoadNode {...props} showRating={showRatings} />,
      generator: (props) => <GeneratorNode {...props} showRating={showRatings} />,
      utility: (props) => <UtilityNode {...props} showRating={showRatings} />,
      transformer: (props) => <TransformerNode {...props} showRating={showRatings} />
    }),
    [showRatings]
  );

  const busNodes = useMemo(() => nodes.filter((n) => n.type === 'bus'), [nodes]);
  const busCount = busNodes.length;

  useEffect(() => {
    if (busNodes.length === 0) {
      setShortCircuitFaultBusId('');
      return;
    }

    const isSelectedBusValid = busNodes.some((bus) => bus.id === shortCircuitFaultBusId);
    if (!isSelectedBusValid) {
      setShortCircuitFaultBusId(busNodes[0].id);
    }
  }, [busNodes, shortCircuitFaultBusId]);

  const onConnect = useCallback((params) => setEdges((eds) => addEdge(params, eds)), [setEdges]);
  const onReconnect = useCallback(
    (oldEdge, newConnection) =>
      setEdges((currentEdges) => reconnectEdge(oldEdge, newConnection, currentEdges)),
    [setEdges]
  );

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/reactflow');
      if (!type || !rfInstance || !reactFlowWrapper.current) return;

      if (type === 'bus' && busCount >= 20) {
        setError('Maximum 20 buses allowed in this version.');
        return;
      }

      const bounds = reactFlowWrapper.current.getBoundingClientRect();
      const position = rfInstance.project({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top
      });

      const countByType = nodes.filter((node) => node.type === type).length + 1;
      const newNode = {
        id: `${type}-${Date.now()}`,
        type,
        position,
        data: defaultDataByType[type](countByType)
      };

      setNodes((nds) => nds.concat(newNode));
      setError('');
    },
    [rfInstance, nodes, setNodes, busCount]
  );

  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const makeId = useCallback(
    (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    []
  );

  const onSelectionChange = useCallback(({ nodes: selectedNds, edges: selectedEds }) => {
    setSelectedNodes(selectedNds);
    setSelectedEdges(selectedEds);
    setSelectedNode(selectedNds.length > 0 ? selectedNds[0] : null);
  }, []);

  const resolveConnectedBus = useCallback(
    (nodeId) => {
      const busSet = new Set(nodes.filter((node) => node.type === 'bus').map((node) => node.id));
      if (busSet.has(nodeId)) return nodeId;

      const connected = edges.find((e) => e.source === nodeId || e.target === nodeId);
      if (!connected) return null;
      const candidate = connected.source === nodeId ? connected.target : connected.source;
      return busSet.has(candidate) ? candidate : null;
    },
    [nodes, edges]
  );

  const buildClipboardFromNodeIds = useCallback(
    (nodeIds) => {
      if (!nodeIds || nodeIds.length === 0) return null;
      const nodeIdSet = new Set(nodeIds);
      const nodesToCopy = nodes.filter((node) => nodeIdSet.has(node.id));
      if (nodesToCopy.length === 0) return null;
      const edgesToCopy = edges.filter(
        (edge) => nodeIdSet.has(edge.source) && nodeIdSet.has(edge.target)
      );
      return { nodes: nodesToCopy, edges: edgesToCopy };
    },
    [nodes, edges]
  );

  const onDeleteSelected = useCallback(() => {
    const selectedNodeIds = new Set(selectedNodes.map((node) => node.id));
    const selectedEdgeIds = new Set(selectedEdges.map((edge) => edge.id));
    if (selectedNodeIds.size === 0 && selectedEdgeIds.size === 0) return;

    setNodes((current) => current.filter((node) => !selectedNodeIds.has(node.id)));
    setEdges((current) =>
      current.filter(
        (edge) =>
          !selectedEdgeIds.has(edge.id) &&
          !selectedNodeIds.has(edge.source) &&
          !selectedNodeIds.has(edge.target)
      )
    );
    setSelectedNodes([]);
    setSelectedEdges([]);
    setSelectedNode(null);
    setError('');
  }, [selectedNodes, selectedEdges, setNodes, setEdges]);

  const onCopySelected = useCallback(() => {
    const copied = buildClipboardFromNodeIds(selectedNodes.map((node) => node.id));
    if (!copied) return;
    setClipboard(copied);
    setError('');
  }, [selectedNodes, buildClipboardFromNodeIds]);

  const onCopyNodesById = useCallback(
    (nodeIds) => {
      const copied = buildClipboardFromNodeIds(nodeIds);
      if (!copied) return;
      setClipboard(copied);
      setError('');
    },
    [buildClipboardFromNodeIds]
  );

  const onCutNodesById = useCallback(
    (nodeIds) => {
      const copied = buildClipboardFromNodeIds(nodeIds);
      if (!copied) return;
      const selectedNodeIds = new Set(nodeIds);

      setClipboard(copied);
      setNodes((current) => current.filter((node) => !selectedNodeIds.has(node.id)));
      setEdges((current) =>
        current.filter(
          (edge) => !selectedNodeIds.has(edge.source) && !selectedNodeIds.has(edge.target)
        )
      );
      setSelectedNodes([]);
      setSelectedEdges([]);
      setSelectedNode(null);
      setError('');
    },
    [buildClipboardFromNodeIds, setNodes, setEdges]
  );

  const onPasteClipboard = useCallback(
    (pasteOrigin = null) => {
      if (clipboard.nodes.length === 0) return;

      const clipboardBusCount = clipboard.nodes.filter((node) => node.type === 'bus').length;
      if (busCount + clipboardBusCount > 20) {
        setError('Pasting exceeds the maximum of 20 buses.');
        return;
      }

      const minX = Math.min(...clipboard.nodes.map((node) => node.position.x));
      const minY = Math.min(...clipboard.nodes.map((node) => node.position.y));
      const targetOrigin = pasteOrigin || { x: minX + 40, y: minY + 40 };

      const nodeIdMap = new Map();
      const pastedNodes = clipboard.nodes.map((node) => {
        const newId = makeId(node.type);
        nodeIdMap.set(node.id, newId);
        return {
          ...node,
          id: newId,
          position: {
            x: targetOrigin.x + (node.position.x - minX),
            y: targetOrigin.y + (node.position.y - minY)
          },
          data: {
            ...node.data,
            isFaulted: false,
            faultCurrentKa: undefined,
            faultVoltageKv: undefined
          },
          selected: true
        };
      });

      const pastedEdges = clipboard.edges
        .filter((edge) => nodeIdMap.has(edge.source) && nodeIdMap.has(edge.target))
        .map((edge) => ({
          ...edge,
          id: makeId('edge'),
          source: nodeIdMap.get(edge.source),
          target: nodeIdMap.get(edge.target),
          selected: true
        }));

      setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), ...pastedNodes]);
      setEdges((current) => [...current.map((edge) => ({ ...edge, selected: false })), ...pastedEdges]);
      setSelectedNodes(pastedNodes);
      setSelectedEdges(pastedEdges);
      setSelectedNode(pastedNodes[0] || null);
      setError('');
    },
    [clipboard, busCount, makeId, setNodes, setEdges]
  );

  const onCutSelected = useCallback(() => {
    if (selectedNodes.length === 0) return;
    onCutNodesById(selectedNodes.map((node) => node.id));
  }, [selectedNodes, onCutNodesById]);

  const mapToPayload = useCallback(() => {
    const buses = nodes
      .filter((n) => n.type === 'bus')
      .map((n) => ({ id: n.id, name: n.data.label, vn_kv: Number(n.data.vn_kv) }));

    const busSet = new Set(buses.map((b) => b.id));

    const lines = edges
      .filter((e) => busSet.has(e.source) && busSet.has(e.target))
      .map((e, index) => ({
        id: e.id || `line-${index + 1}`,
        from_bus: e.source,
        to_bus: e.target,
        length_km: 1,
        r_ohm_per_km: 0.642,
        x_ohm_per_km: 0.083,
        c_nf_per_km: 210,
        max_i_ka: 0.3
      }));

    const loads = nodes
      .filter((n) => n.type === 'load' || n.type === 'resistive_load')
      .map((n) => ({
        id: n.id,
        bus: resolveConnectedBus(n.id),
        p_mw: Number(n.data.p_mw),
        q_mvar: n.type === 'resistive_load' ? 0 : Number(n.data.q_mvar)
      }))
      .filter((l) => l.bus);

    const generators = nodes
      .filter((n) => n.type === 'generator' || n.type === 'utility')
      .map((n) => ({
        id: n.id,
        bus: resolveConnectedBus(n.id),
        p_mw: Number(n.data.p_mw),
        vm_pu: Number(n.data.vm_pu)
      }))
      .filter((g) => g.bus);

    const transformerLines = nodes
      .filter((n) => n.type === 'transformer')
      .map((transformerNode) => {
        const connectedBuses = edges
          .filter((edge) => edge.source === transformerNode.id || edge.target === transformerNode.id)
          .map((edge) => (edge.source === transformerNode.id ? edge.target : edge.source))
          .filter((nodeId) => busSet.has(nodeId));
        const uniqueBuses = [...new Set(connectedBuses)];
        if (uniqueBuses.length < 2) return null;
        return {
          id: `line-${transformerNode.id}`,
          from_bus: uniqueBuses[0],
          to_bus: uniqueBuses[1],
          length_km: 0.05,
          r_ohm_per_km: 0.08,
          x_ohm_per_km: 0.12,
          c_nf_per_km: 0,
          max_i_ka: 0.8
        };
      })
      .filter(Boolean);

    return { buses, lines: [...lines, ...transformerLines], loads, generators };
  }, [nodes, edges, resolveConnectedBus]);

  const callStudy = useCallback(
    async (studyType) => {
      try {
        setError('');
        setResult(null);
        const payload = mapToPayload();
        if (studyType === 'protection') {
          setError('Protection coordination calculations are not yet connected to the backend.');
          return;
        }

        const endpoint =
          studyType === 'loadflow' ? '/api/calculate/load-flow' : '/api/calculate/short-circuit';

        if (studyType === 'shortcircuit') {
          if (!shortCircuitFaultBusId) {
            setError('Select a fault bus before running short-circuit analysis.');
            return;
          }

          payload.fault_bus_id = shortCircuitFaultBusId;
          payload.fault_type = shortCircuitFaultType;
        }

        const response = await axios.post(`${API_BASE}${endpoint}`, payload);
        if (studyType === 'shortcircuit') {
          const faultBusId = response.data?.fault?.bus_id;
          const currentKa = response.data?.fault_bus?.current_ka;
          const voltageKv = response.data?.fault_bus?.voltage_level_kv;
          setNodes((currentNodes) =>
            currentNodes.map((node) => {
              if (node.type !== 'bus') return node;
              if (node.id === faultBusId) {
                return {
                  ...node,
                  data: {
                    ...node.data,
                    isFaulted: true,
                    faultCurrentKa: currentKa,
                    faultVoltageKv: voltageKv
                  }
                };
              }
              return {
                ...node,
                data: {
                  ...node.data,
                  isFaulted: false,
                  faultCurrentKa: undefined,
                  faultVoltageKv: undefined
                }
              };
            })
          );
        } else {
          setNodes((currentNodes) =>
            currentNodes.map((node) => ({
              ...node,
              data:
                node.type === 'bus'
                  ? {
                      ...node.data,
                      isFaulted: false,
                      faultCurrentKa: undefined,
                      faultVoltageKv: undefined
                    }
                  : node.data
            }))
          );
        }
        setResult(response.data);
      } catch (err) {
        setError(err.response?.data?.detail || err.message);
      }
    },
    [mapToPayload, shortCircuitFaultBusId, shortCircuitFaultType]
  );

  const onUpdateNode = (field, value) => {
    if (!selectedNode) return;
    setNodes((current) =>
      current.map((node) =>
        node.id === selectedNode.id ? { ...node, data: { ...node.data, [field]: value } } : node
      )
    );
    setSelectedNode((current) => ({ ...current, data: { ...current.data, [field]: value } }));
  };

  const createSnapshot = useCallback((graphNodes, graphEdges) => {
    const normalizedNodes = graphNodes.map(({ selected, dragging, positionAbsolute, ...node }) => ({
      ...node
    }));
    const normalizedEdges = graphEdges.map(({ selected, ...edge }) => ({ ...edge }));
    return {
      nodes: JSON.parse(JSON.stringify(normalizedNodes)),
      edges: JSON.parse(JSON.stringify(normalizedEdges))
    };
  }, []);

  const clearSelectionState = useCallback(() => {
    setSelectedNode(null);
    setSelectedNodes([]);
    setSelectedEdges([]);
    setContextMenu(null);
  }, []);

  const onLoadTemplate = useCallback(() => {
    const templateNodes = [
      { id: 'bus-1', type: 'bus', position: { x: 320, y: 120 }, data: { label: 'Bus 1', vn_kv: 33 } },
      { id: 'bus-2', type: 'bus', position: { x: 320, y: 320 }, data: { label: 'Bus 2', vn_kv: 11 } },
      {
        id: 'load-1',
        type: 'load',
        position: { x: 460, y: 470 },
        data: { label: 'Motor A', p_mw: 4, q_mvar: 1.5 }
      },
      {
        id: 'load-2',
        type: 'load',
        position: { x: 320, y: 470 },
        data: { label: 'Motor B', p_mw: 3.2, q_mvar: 1.1 }
      },
      {
        id: 'resistive-load-1',
        type: 'resistive_load',
        position: { x: 600, y: 470 },
        data: { label: 'Resistive A', p_mw: 1.2, q_mvar: 0 }
      },
      {
        id: 'utility-1',
        type: 'utility',
        position: { x: 320, y: 20 },
        data: { label: 'Utility', p_mw: 0, vm_pu: 1.0 }
      },
      {
        id: 'transformer-1',
        type: 'transformer',
        position: { x: 320, y: 220 },
        data: { label: 'TX 1', hv_kv: 33, lv_kv: 11 }
      }
    ];

    const templateEdges = [
      { id: 'e-util-b1', source: 'utility-1', target: 'bus-1' },
      { id: 'e-b1-tx', source: 'bus-1', target: 'transformer-1' },
      { id: 'e-tx-b2', source: 'transformer-1', target: 'bus-2' },
      { id: 'e-b2-load1', source: 'bus-2', target: 'load-1' },
      { id: 'e-b2-load2', source: 'bus-2', target: 'load-2' },
      { id: 'e-b2-rload1', source: 'bus-2', target: 'resistive-load-1' }
    ];

    let centeredTemplateNodes = templateNodes;
    if (rfInstance && reactFlowWrapper.current) {
      const minX = Math.min(...templateNodes.map((node) => node.position.x));
      const maxX = Math.max(...templateNodes.map((node) => node.position.x));
      const minY = Math.min(...templateNodes.map((node) => node.position.y));
      const maxY = Math.max(...templateNodes.map((node) => node.position.y));
      const templateCenter = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };

      const bounds = reactFlowWrapper.current.getBoundingClientRect();
      const flowCenter = rfInstance.project({
        x: bounds.width / 2,
        y: bounds.height / 2
      });

      const offsetX = flowCenter.x - templateCenter.x;
      const offsetY = flowCenter.y - templateCenter.y;

      centeredTemplateNodes = templateNodes.map((node) => ({
        ...node,
        position: {
          x: node.position.x + offsetX,
          y: node.position.y + offsetY
        }
      }));
    }

    setNodes(centeredTemplateNodes);
    setEdges(templateEdges);
    clearSelectionState();
    setResult(null);
    setError('');
  }, [setNodes, setEdges, clearSelectionState, rfInstance]);

  const openContextMenu = useCallback(
    (event, nodeId = null) => {
      event.preventDefault();
      if (!reactFlowWrapper.current || !rfInstance) return;
      const bounds = reactFlowWrapper.current.getBoundingClientRect();
      setContextMenu({
        nodeId,
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
        flowPosition: rfInstance.project({
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top
        })
      });
    },
    [rfInstance]
  );

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
    setContextMenu(null);
  }, []);

  useEffect(() => {
    if (isRestoringHistoryRef.current) {
      isRestoringHistoryRef.current = false;
      return;
    }

    const snapshotKey = JSON.stringify(createSnapshot(nodes, edges));
    if (snapshotKey === lastSnapshotRef.current) return;

    historyRef.current.push(createSnapshot(nodes, edges));
    if (historyRef.current.length > 100) {
      historyRef.current.shift();
    }
    lastSnapshotRef.current = snapshotKey;
    futureRef.current = [];
  }, [nodes, edges, createSnapshot]);

  const onUndo = useCallback(() => {
    if (historyRef.current.length <= 1) return;

    const currentSnapshot = historyRef.current.pop();
    const previousSnapshot = historyRef.current[historyRef.current.length - 1];
    if (!currentSnapshot || !previousSnapshot) return;

    futureRef.current.push(currentSnapshot);
    isRestoringHistoryRef.current = true;
    setNodes(previousSnapshot.nodes);
    setEdges(previousSnapshot.edges);
    clearSelectionState();
    setError('');
  }, [setNodes, setEdges, clearSelectionState]);

  const onRedo = useCallback(() => {
    if (futureRef.current.length === 0) return;

    const redoSnapshot = futureRef.current.pop();
    if (!redoSnapshot) return;

    historyRef.current.push(redoSnapshot);
    isRestoringHistoryRef.current = true;
    setNodes(redoSnapshot.nodes);
    setEdges(redoSnapshot.edges);
    clearSelectionState();
    setError('');
  }, [setNodes, setEdges, clearSelectionState]);

  const onNodeContextMenu = useCallback(
    (event, node) => {
      const isNodeSelected = selectedNodes.some((selected) => selected.id === node.id);
      openContextMenu(event, isNodeSelected ? node.id : null);
    },
    [openContextMenu, selectedNodes]
  );

  const onPaneContextMenu = useCallback(
    (event) => {
      openContextMenu(event, null);
    },
    [openContextMenu]
  );

  const onContextAction = useCallback(
    (action) => {
      if (!contextMenu) return;

      const targetNodeId = contextMenu.nodeId;
      const contextTargetNodeIds =
        targetNodeId && selectedNodes.some((node) => node.id === targetNodeId)
          ? selectedNodes.map((node) => node.id)
          : targetNodeId
            ? [targetNodeId]
            : [];

      if (action === 'copy') {
        onCopyNodesById(contextTargetNodeIds);
      } else if (action === 'cut') {
        onCutNodesById(contextTargetNodeIds);
      } else if (action === 'paste') {
        onPasteClipboard(contextMenu.flowPosition);
      } else if (action === 'fault') {
        if (!targetNodeId) {
          setContextMenu(null);
          return;
        }
        const targetNode = nodes.find((node) => node.id === targetNodeId);
        if (!targetNode || targetNode.type !== 'bus') {
          setContextMenu(null);
          return;
        }
        setShortCircuitFaultBusId(targetNode.id);
        setError('');
      }
      setContextMenu(null);
    },
    [
      contextMenu,
      selectedNodes,
      nodes,
      onCopyNodesById,
      onCutNodesById,
      onPasteClipboard
    ]
  );

  const onKeyDown = useCallback(
    (event) => {
      const targetTag = event.target?.tagName?.toLowerCase();
      const isTyping =
        targetTag === 'input' ||
        targetTag === 'textarea' ||
        targetTag === 'select' ||
        event.target?.isContentEditable;
      if (isTyping) return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        onCopySelected();
      }

      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        onUndo();
      }

      if (
        ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') ||
        (event.metaKey && event.shiftKey && event.key.toLowerCase() === 'z')
      ) {
        event.preventDefault();
        onRedo();
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'x') {
        event.preventDefault();
        onCutSelected();
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        onPasteClipboard();
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        onDeleteSelected();
      }
    },
    [onCopySelected, onUndo, onRedo, onCutSelected, onPasteClipboard, onDeleteSelected]
  );

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onKeyDown]);

  useEffect(() => {
    setResult(null);
    setError('');
  }, [studyType]);

  return (
    <div className="layout">
      <Palette />
      <div className="canvas" ref={reactFlowWrapper} tabIndex={0}>
        <div className="canvas-toolbar">
          <label className="canvas-toggle">
            <input
              type="checkbox"
              checked={showRatings}
              onChange={(event) => setShowRatings(event.target.checked)}
            />
            Show ratings
          </label>
        </div>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          defaultEdgeOptions={{ type: 'smoothstep' }}
          connectionLineType={ConnectionLineType.SmoothStep}
          edgesUpdatable
          reconnectRadius={20}
          selectionOnDrag
          selectionMode={SelectionMode.Partial}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onSelectionChange={onSelectionChange}
          onConnect={onConnect}
          onReconnect={onReconnect}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onInit={setRfInstance}
          onNodeContextMenu={onNodeContextMenu}
          onPaneContextMenu={onPaneContextMenu}
          onPaneClick={onPaneClick}
          fitView
        >
          <MiniMap />
          <Controls />
          <Background />
        </ReactFlow>
        {contextMenu && (
          <div className="node-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
            <button
              type="button"
              onClick={() => onContextAction('copy')}
              disabled={!contextMenu.nodeId}
            >
              Copy
            </button>
            <button
              type="button"
              onClick={() => onContextAction('cut')}
              disabled={!contextMenu.nodeId}
            >
              Cut
            </button>
            <button
              type="button"
              onClick={() => onContextAction('paste')}
              disabled={clipboard.nodes.length === 0}
            >
              Paste
            </button>
            {contextMenu.nodeId &&
              nodes.some((node) => node.id === contextMenu.nodeId && node.type === 'bus') && (
                <button type="button" onClick={() => onContextAction('fault')}>
                  Fault
                </button>
              )}
          </div>
        )}
      </div>
      <ControlPanel
        studyType={studyType}
        onRunLoadFlow={() => callStudy('loadflow')}
        onRunShortCircuit={() => callStudy('shortcircuit')}
        onLoadTemplate={onLoadTemplate}
        selectedNode={selectedNode}
        onUpdateNode={onUpdateNode}
        selectedNodesCount={selectedNodes.length}
        selectedEdgesCount={selectedEdges.length}
        result={result}
        error={error}
        busCount={busCount}
        busNodes={busNodes}
        shortCircuitFaultType={shortCircuitFaultType}
        onShortCircuitFaultTypeChange={setShortCircuitFaultType}
        shortCircuitFaultBusId={shortCircuitFaultBusId}
        onShortCircuitFaultBusIdChange={setShortCircuitFaultBusId}
      />
    </div>
  );
}

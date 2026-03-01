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
import Palette from './components/Palette';
import ControlPanel from './components/ControlPanel';
import { BusNode, GeneratorNode, LoadNode } from './components/SymbolNodes';

const API_BASE = 'http://127.0.0.1:8000';

const defaultDataByType = {
  bus: (index) => ({ label: `Bus ${index}`, vn_kv: 11 }),
  load: (index) => ({ label: `Motor ${index}`, p_mw: 1.5, q_mvar: 0.7 }),
  generator: (index) => ({ label: `Gen ${index}`, p_mw: 1.0, vm_pu: 1.0 })
};

export default function App() {
  const reactFlowWrapper = useRef(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [rfInstance, setRfInstance] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedNodes, setSelectedNodes] = useState([]);
  const [selectedEdges, setSelectedEdges] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [shortCircuitFaultType, setShortCircuitFaultType] = useState('three_phase');
  const [shortCircuitFaultBusId, setShortCircuitFaultBusId] = useState('');
  const [contextMenu, setContextMenu] = useState(null);
  const nodeTypes = useMemo(
    () => ({
      bus: BusNode,
      load: LoadNode,
      generator: GeneratorNode
    }),
    []
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

  const makeId = useCallback((prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, []);

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
    if (selectedNodes.length === 0 && selectedEdges.length === 0) return;

    const selectedNodeIds = new Set(selectedNodes.map((node) => node.id));
    const nodeIdMap = new Map();
    const copiedNodes = selectedNodes.map((node) => {
      const newId = makeId(node.type);
      nodeIdMap.set(node.id, newId);
      return {
        ...node,
        id: newId,
        position: { x: node.position.x + 40, y: node.position.y + 40 },
        data: {
          ...node.data,
          label: `${node.data.label} Copy`
        },
        selected: true
      };
    });

    const edgesToClone = [];
    selectedEdges.forEach((edge) => {
      edgesToClone.push(edge);
    });

    edges.forEach((edge) => {
      if (
        selectedNodeIds.has(edge.source) &&
        selectedNodeIds.has(edge.target) &&
        !selectedEdges.some((selectedEdge) => selectedEdge.id === edge.id)
      ) {
        edgesToClone.push(edge);
      }
    });

    const copiedEdges = edgesToClone.map((edge) => ({
      ...edge,
      id: makeId('edge'),
      source: nodeIdMap.get(edge.source) || edge.source,
      target: nodeIdMap.get(edge.target) || edge.target,
      selected: true
    }));

    setNodes((current) => [
      ...current.map((node) => ({ ...node, selected: false })),
      ...copiedNodes
    ]);
    setEdges((current) => [
      ...current.map((edge) => ({ ...edge, selected: false })),
      ...copiedEdges
    ]);
    setSelectedNodes(copiedNodes);
    setSelectedEdges(copiedEdges);
    setSelectedNode(copiedNodes[0] || null);
    setError('');
  }, [selectedNodes, selectedEdges, edges, makeId, setNodes, setEdges]);

  const onCopyNodesById = useCallback(
    (nodeIds) => {
      if (nodeIds.length === 0) return;

      const selectedNodeIds = new Set(nodeIds);
      const nodesToCopy = nodes.filter((node) => selectedNodeIds.has(node.id));
      if (nodesToCopy.length === 0) return;

      const nodeIdMap = new Map();
      const copiedNodes = nodesToCopy.map((node) => {
        const newId = makeId(node.type);
        nodeIdMap.set(node.id, newId);
        return {
          ...node,
          id: newId,
          position: { x: node.position.x + 40, y: node.position.y + 40 },
          data: {
            ...node.data,
            label: `${node.data.label} Copy`,
            isFaulted: false,
            faultCurrentKa: undefined,
            faultVoltageKv: undefined
          },
          selected: true
        };
      });

      const copiedEdges = edges
        .filter((edge) => selectedNodeIds.has(edge.source) && selectedNodeIds.has(edge.target))
        .map((edge) => ({
          ...edge,
          id: makeId('edge'),
          source: nodeIdMap.get(edge.source) || edge.source,
          target: nodeIdMap.get(edge.target) || edge.target,
          selected: true
        }));

      setNodes((current) => [
        ...current.map((node) => ({ ...node, selected: false })),
        ...copiedNodes
      ]);
      setEdges((current) => [
        ...current.map((edge) => ({ ...edge, selected: false })),
        ...copiedEdges
      ]);
      setSelectedNodes(copiedNodes);
      setSelectedEdges(copiedEdges);
      setSelectedNode(copiedNodes[0] || null);
      setError('');
    },
    [nodes, edges, makeId, setNodes, setEdges]
  );

  const onCutNodesById = useCallback(
    (nodeIds) => {
      if (nodeIds.length === 0) return;
      const selectedNodeIds = new Set(nodeIds);

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
    [setNodes, setEdges]
  );

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
      .filter((n) => n.type === 'load')
      .map((n) => ({
        id: n.id,
        bus: resolveConnectedBus(n.id),
        p_mw: Number(n.data.p_mw),
        q_mvar: Number(n.data.q_mvar)
      }))
      .filter((l) => l.bus);

    const generators = nodes
      .filter((n) => n.type === 'generator')
      .map((n) => ({
        id: n.id,
        bus: resolveConnectedBus(n.id),
        p_mw: Number(n.data.p_mw),
        vm_pu: Number(n.data.vm_pu)
      }))
      .filter((g) => g.bus);

    return { buses, lines, loads, generators };
  }, [nodes, edges, resolveConnectedBus]);

  const callStudy = useCallback(
    async (studyType) => {
      try {
        setError('');
        setResult(null);
        const payload = mapToPayload();
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

  const onLoadTemplate = () => {
    setNodes([
      { id: 'bus-1', type: 'bus', position: { x: 320, y: 80 }, data: { label: 'Bus 1', vn_kv: 33 } },
      { id: 'bus-2', type: 'bus', position: { x: 320, y: 230 }, data: { label: 'Bus 2', vn_kv: 33 } },
      {
        id: 'load-1',
        type: 'load',
        position: { x: 460, y: 380 },
        data: { label: 'Motor A', p_mw: 4, q_mvar: 1.5 }
      },
      {
        id: 'generator-1',
        type: 'generator',
        position: { x: 180, y: 380 },
        data: { label: 'Gen A', p_mw: 5, vm_pu: 1.02 }
      }
    ]);
    setEdges([
      { id: 'e-b1-b2', source: 'bus-1', target: 'bus-2' },
      { id: 'e-load1-b2', source: 'load-1', target: 'bus-2' },
      { id: 'e-g1-b1', source: 'generator-1', target: 'bus-1' }
    ]);
    setResult(null);
    setError('');
    setContextMenu(null);
  };

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
    setContextMenu(null);
  }, []);

  const onNodeContextMenu = useCallback((event, node) => {
    event.preventDefault();
    if (!reactFlowWrapper.current) return;
    const bounds = reactFlowWrapper.current.getBoundingClientRect();
    setContextMenu({
      nodeId: node.id,
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top
    });
  }, []);

  const onContextAction = useCallback(
    (action) => {
      if (!contextMenu) return;
      const targetNodeId = contextMenu.nodeId;
      if (action === 'copy') {
        onCopyNodesById([targetNodeId]);
      } else if (action === 'cut') {
        onCutNodesById([targetNodeId]);
      } else if (action === 'fault') {
        const busId = resolveConnectedBus(targetNodeId);
        if (!busId) {
          setError('No connected bus found to set as faulted bus.');
          setContextMenu(null);
          return;
        }
        setShortCircuitFaultBusId(busId);
        setError('');
      }
      setContextMenu(null);
    },
    [contextMenu, onCopyNodesById, onCutNodesById, resolveConnectedBus]
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

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        onDeleteSelected();
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'x') {
        event.preventDefault();
        onDeleteSelected();
      }
    },
    [onCopySelected, onDeleteSelected]
  );

  return (
    <div className="layout">
      <Palette />
      <div className="canvas" ref={reactFlowWrapper} onKeyDown={onKeyDown} tabIndex={0}>
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
          onPaneClick={onPaneClick}
          fitView
        >
          <MiniMap />
          <Controls />
          <Background />
        </ReactFlow>
        {contextMenu && (
          <div className="node-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
            <button type="button" onClick={() => onContextAction('copy')}>
              Copy
            </button>
            <button type="button" onClick={() => onContextAction('cut')}>
              Cut
            </button>
            <button type="button" onClick={() => onContextAction('fault')}>
              Fault
            </button>
          </div>
        )}
      </div>
      <ControlPanel
        onRunLoadFlow={() => callStudy('loadflow')}
        onRunShortCircuit={() => callStudy('shortcircuit')}
        onLoadTemplate={onLoadTemplate}
        selectedNode={selectedNode}
        onUpdateNode={onUpdateNode}
        onCopySelected={onCopySelected}
        onDeleteSelected={onDeleteSelected}
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

import { useCallback, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  useEdgesState,
  useNodesState
} from 'reactflow';
import 'reactflow/dist/style.css';
import axios from 'axios';
import Palette from './components/Palette';
import ControlPanel from './components/ControlPanel';

const API_BASE = 'http://127.0.0.1:8000';

const defaultDataByType = {
  bus: (index) => ({ label: `Bus ${index}`, vn_kv: 11 }),
  load: (index) => ({ label: `Load ${index}`, p_mw: 1.0, q_mvar: 0.3 }),
  generator: (index) => ({ label: `Gen ${index}`, p_mw: 1.0, vm_pu: 1.0 })
};

export default function App() {
  const reactFlowWrapper = useRef(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [rfInstance, setRfInstance] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const busCount = useMemo(() => nodes.filter((n) => n.type === 'bus').length, [nodes]);

  const onConnect = useCallback((params) => setEdges((eds) => addEdge(params, eds)), [setEdges]);

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

    const resolveConnectedBus = (nodeId) => {
      const connected = edges.find((e) => e.source === nodeId || e.target === nodeId);
      if (!connected) return null;
      const candidate = connected.source === nodeId ? connected.target : connected.source;
      return busSet.has(candidate) ? candidate : null;
    };

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
  }, [nodes, edges]);

  const callStudy = useCallback(
    async (studyType) => {
      try {
        setError('');
        setResult(null);
        const payload = mapToPayload();
        const endpoint =
          studyType === 'loadflow' ? '/api/calculate/load-flow' : '/api/calculate/short-circuit';
        const response = await axios.post(`${API_BASE}${endpoint}`, payload);
        setResult(response.data);
      } catch (err) {
        setError(err.response?.data?.detail || err.message);
      }
    },
    [mapToPayload]
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
      { id: 'bus-1', type: 'bus', position: { x: 200, y: 100 }, data: { label: 'Bus 1', vn_kv: 33 } },
      { id: 'bus-2', type: 'bus', position: { x: 450, y: 100 }, data: { label: 'Bus 2', vn_kv: 33 } },
      {
        id: 'load-1',
        type: 'load',
        position: { x: 450, y: 260 },
        data: { label: 'Load A', p_mw: 4, q_mvar: 1.5 }
      },
      {
        id: 'generator-1',
        type: 'generator',
        position: { x: 200, y: 260 },
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
  };

  return (
    <div className="layout">
      <Palette />
      <div className="canvas" ref={reactFlowWrapper}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onInit={setRfInstance}
          onNodeClick={(_, node) => setSelectedNode(node)}
          fitView
        >
          <MiniMap />
          <Controls />
          <Background />
        </ReactFlow>
      </div>
      <ControlPanel
        onRunLoadFlow={() => callStudy('loadflow')}
        onRunShortCircuit={() => callStudy('shortcircuit')}
        onLoadTemplate={onLoadTemplate}
        selectedNode={selectedNode}
        onUpdateNode={onUpdateNode}
        result={result}
        error={error}
        busCount={busCount}
      />
    </div>
  );
}

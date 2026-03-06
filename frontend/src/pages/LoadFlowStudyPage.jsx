import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
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
import { formatCurrentFromKa } from '../utils/unitFormat';

const API_BASE = 'http://127.0.0.1:8000';
const STORAGE_KEY_PREFIX = 'openpower:network:';
const LOAD_FLOW_NODE_TYPES = new Set(['load', 'resistive_load', 'generator', 'utility']);
const TRANSIENT_NODE_DATA_KEYS = new Set([
  'isFaulted',
  'isFaultSelected',
  'faultCurrentKa',
  'faultVoltageKv',
  'faultCurrentLabel',
  'loadFlowCurrentKa',
  'loadFlowVoltageKv',
  'loadFlowIncomingCurrentKa',
  'loadFlowOutgoingCurrentKa'
]);

function getStorageKey(studyType) {
  if (studyType === 'loadflow' || studyType === 'shortcircuit') {
    return `${STORAGE_KEY_PREFIX}shared`;
  }
  return `${STORAGE_KEY_PREFIX}${studyType}`;
}

function sanitizeNodeForPersistence(node) {
  const nextData = { ...(node?.data || {}) };
  TRANSIENT_NODE_DATA_KEYS.forEach((key) => {
    if (key in nextData) delete nextData[key];
  });
  return { ...node, data: nextData };
}

function sanitizeEdgeForPersistence(edge) {
  return {
    ...edge,
    label: undefined,
    labelStyle: undefined,
    labelShowBg: undefined,
    markerStart: undefined,
    markerEnd: undefined
  };
}

function sanitizeGraphForPersistence(graph) {
  return {
    nodes: Array.isArray(graph?.nodes) ? graph.nodes.map(sanitizeNodeForPersistence) : [],
    edges: Array.isArray(graph?.edges) ? graph.edges.map(sanitizeEdgeForPersistence) : []
  };
}

function loadPersistedGraph(studyType) {
  if (typeof window === 'undefined') {
    return { nodes: [], edges: [] };
  }

  try {
    const currentKey = getStorageKey(studyType);
    const legacyKey =
      studyType === 'loadflow' || studyType === 'shortcircuit'
        ? `${STORAGE_KEY_PREFIX}${studyType}`
        : null;
    const raw = window.localStorage.getItem(currentKey) || (legacyKey ? window.localStorage.getItem(legacyKey) : null);
    if (!raw) return { nodes: [], edges: [] };
    const parsed = JSON.parse(raw);
    return sanitizeGraphForPersistence(parsed);
  } catch {
    return { nodes: [], edges: [] };
  }
}

const defaultDataByType = {
  bus: (index) => ({ label: `Bus ${index}`, vn_kv: 11 }),
  load: (index) => ({ label: `Motor ${index}`, kv: 0.415, p_mw: 1.5, pf: 0.9 }),
  resistive_load: (index) => ({ label: `Resistive ${index}`, p_mw: 1.2 }),
  generator: (index) => ({ label: `Gen ${index}`, p_mw: 1.0, vm_pu: 1.0 }),
  utility: (index) => ({ label: `Utility ${index}`, mvasc: 1000, vm_pu: 1.0, p_mw: 0.0 }),
  transformer: (index) => ({
    label: `TX ${index}`,
    hv_kv: 33,
    lv_kv: 11,
    mva_rating: 10,
    z_percent: 6,
    vector_group: 'Dyn11',
    xr_ratio: 10
  })
};

export default function LoadFlowStudyPage({ studyType = 'loadflow' }) {
  const initialGraph = useMemo(() => loadPersistedGraph(studyType), [studyType]);
  const reactFlowWrapper = useRef(null);
  const historyRef = useRef([]);
  const futureRef = useRef([]);
  const isRestoringHistoryRef = useRef(false);
  const lastSnapshotRef = useRef('');
  const [nodes, setNodes, onNodesChange] = useNodesState(initialGraph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialGraph.edges);
  const [rfInstance, setRfInstance] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedNodes, setSelectedNodes] = useState([]);
  const [selectedEdges, setSelectedEdges] = useState([]);
  const [clipboard, setClipboard] = useState({ nodes: [], edges: [] });
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [showRatings, setShowRatings] = useState(false);
  const [shortCircuitFaultType, setShortCircuitFaultType] = useState('three_phase');
  const [shortCircuitCurrentType, setShortCircuitCurrentType] = useState('initial_symmetrical');
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
      setShortCircuitFaultBusId('');
    }
  }, [busNodes, shortCircuitFaultBusId]);

  useEffect(() => {
    setNodes((currentNodes) => {
      let changed = false;
      const nextNodes = currentNodes.map((node) => {
        if (node.type !== 'bus') return node;
        const isFaultSelected =
          studyType === 'shortcircuit' &&
          Boolean(shortCircuitFaultBusId) &&
          node.id === shortCircuitFaultBusId;
        if (Boolean(node.data?.isFaultSelected) === isFaultSelected) return node;
        changed = true;
        return {
          ...node,
          data: {
            ...node.data,
            isFaultSelected
          }
        };
      });
      return changed ? nextNodes : currentNodes;
    });
  }, [setNodes, shortCircuitFaultBusId, studyType]);

  const onConnect = useCallback(
    (params) => {
      const sourceNode = nodes.find((node) => node.id === params.source);
      const targetNode = nodes.find((node) => node.id === params.target);

      setEdges((eds) =>
        addEdge(
          {
            ...params,
            sourceHandle:
              params.sourceHandle ?? (sourceNode?.type === 'bus' ? 'bottom-3' : undefined),
            targetHandle: params.targetHandle ?? (targetNode?.type === 'bus' ? 'top-3' : undefined),
            type: 'straight',
            markerStart: undefined,
            markerEnd: undefined,
            style: { stroke: '#b8bec7', strokeWidth: 3 }
          },
          eds
        )
      );
    },
    [setEdges, nodes]
  );
  const onReconnect = useCallback(
    (oldEdge, newConnection) =>
      setEdges((currentEdges) => reconnectEdge(oldEdge, newConnection, currentEdges)),
    [setEdges]
  );

  const clearLoadFlowAnnotations = useCallback(() => {
    setNodes((currentNodes) =>
      currentNodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          loadFlowCurrentKa: undefined,
          loadFlowVoltageKv: undefined,
          loadFlowIncomingCurrentKa: undefined,
          loadFlowOutgoingCurrentKa: undefined
        }
      }))
    );
    setEdges((currentEdges) =>
      currentEdges.map((edge) => ({
        ...edge,
        label: undefined,
        labelStyle: undefined,
        markerStart: undefined,
        markerEnd: undefined,
        style: { stroke: '#b8bec7', strokeWidth: 3 }
      }))
    );
  }, [setNodes, setEdges]);

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
            faultVoltageKv: undefined,
            faultCurrentLabel: undefined,
            loadFlowCurrentKa: undefined,
            loadFlowVoltageKv: undefined,
            loadFlowIncomingCurrentKa: undefined,
            loadFlowOutgoingCurrentKa: undefined
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
    const busVoltageById = new Map(
      buses.map((bus) => [bus.id, Number.isFinite(Number(bus.vn_kv)) ? Number(bus.vn_kv) : 0])
    );

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
      .map((n) => {
        const pMw = Number(n.data.p_mw);
        const pfRaw = Number(n.data.pf);
        const pf = Number.isFinite(pfRaw) && pfRaw > 0 && pfRaw <= 1 ? pfRaw : 1;
        const qFromPf = pMw * Math.tan(Math.acos(pf));
        return {
          id: n.id,
          bus: resolveConnectedBus(n.id),
          p_mw: pMw,
          q_mvar: n.type === 'resistive_load' ? 0 : qFromPf,
          load_type: n.type === 'load' ? 'motor' : 'static'
        };
      })
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

    const transformers = nodes
      .filter((n) => n.type === 'transformer')
      .map((transformerNode) => {
        const connectedBuses = edges
          .filter((edge) => edge.source === transformerNode.id || edge.target === transformerNode.id)
          .map((edge) => (edge.source === transformerNode.id ? edge.target : edge.source))
          .filter((nodeId) => busSet.has(nodeId));
        const uniqueBuses = [...new Set(connectedBuses)];
        if (uniqueBuses.length < 2) return null;

        const hvKvRaw = Number(transformerNode.data?.hv_kv);
        const lvKvRaw = Number(transformerNode.data?.lv_kv);
        const mvaRatingRaw = Number(transformerNode.data?.mva_rating);
        const zPercentRaw = Number(transformerNode.data?.z_percent);
        const xrRatioRaw = Number(transformerNode.data?.xr_ratio);

        const hvKv = Number.isFinite(hvKvRaw) && hvKvRaw > 0 ? hvKvRaw : 11;
        const lvKv = Number.isFinite(lvKvRaw) && lvKvRaw > 0 ? lvKvRaw : hvKv;
        const mvaRating = Number.isFinite(mvaRatingRaw) && mvaRatingRaw > 0 ? mvaRatingRaw : 10;
        const zPercent = Number.isFinite(zPercentRaw) && zPercentRaw > 0 ? zPercentRaw : 6;
        const xrRatio = Number.isFinite(xrRatioRaw) && xrRatioRaw > 0 ? xrRatioRaw : 10;
        const vkPercent = Math.max(zPercent, 0.01);
        const vkrPercent = Math.max(vkPercent / Math.sqrt(1 + xrRatio ** 2), 0.001);

        const [busA, busB] = uniqueBuses;
        const busAKv = busVoltageById.get(busA) ?? 0;
        const busBKv = busVoltageById.get(busB) ?? 0;
        const directMatchError = Math.abs(busAKv - hvKv) + Math.abs(busBKv - lvKv);
        const swappedMatchError = Math.abs(busBKv - hvKv) + Math.abs(busAKv - lvKv);
        const hvBus = directMatchError <= swappedMatchError ? busA : busB;
        const lvBus = hvBus === busA ? busB : busA;

        return {
          id: transformerNode.id,
          hv_bus: hvBus,
          lv_bus: lvBus,
          sn_mva: mvaRating,
          vn_hv_kv: hvKv,
          vn_lv_kv: lvKv,
          vk_percent: vkPercent,
          vkr_percent: vkrPercent,
          vector_group:
            typeof transformerNode.data?.vector_group === 'string' &&
            transformerNode.data.vector_group.trim().length > 0
              ? transformerNode.data.vector_group.trim()
              : null,
          shift_degree: 0
        };
      })
      .filter(Boolean);

    return { buses, lines, transformers, loads, generators };
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
          payload.current_type = shortCircuitCurrentType;
        }

        const response = await axios.post(`${API_BASE}${endpoint}`, payload);
        if (studyType === 'shortcircuit') {
          clearLoadFlowAnnotations();
          const faultBusId = response.data?.fault?.bus_id;
          const currentKa = response.data?.fault_bus?.current_ka;
          const voltageKv = response.data?.fault_bus?.voltage_level_kv;
          const currentTypeLabel = response.data?.fault?.current_type_label || 'Short-circuit current';
          const branchResults = response.data?.branches || {};
          const motorContributions = response.data?.motor_contributions || {};
          const nodeTypeById = new Map(nodes.map((node) => [node.id, node.type]));
          const nodeLabelById = new Map(
            nodes.map((node) => [node.id, String(node.data?.label || node.id)])
          );

          const adjacency = new Map();
          Object.values(branchResults).forEach((branch) => {
            const fromBus = branch?.from_bus_id;
            const toBus = branch?.to_bus_id;
            if (!fromBus || !toBus) return;
            if (!adjacency.has(fromBus)) adjacency.set(fromBus, new Set());
            if (!adjacency.has(toBus)) adjacency.set(toBus, new Set());
            adjacency.get(fromBus).add(toBus);
            adjacency.get(toBus).add(fromBus);
          });

          const busDistanceToFault = new Map();
          if (faultBusId) {
            const queue = [faultBusId];
            busDistanceToFault.set(faultBusId, 0);
            while (queue.length > 0) {
              const currentBus = queue.shift();
              const currentDistance = busDistanceToFault.get(currentBus) ?? 0;
              const neighbors = adjacency.get(currentBus);
              if (!neighbors) continue;
              neighbors.forEach((nextBus) => {
                if (busDistanceToFault.has(nextBus)) return;
                busDistanceToFault.set(nextBus, currentDistance + 1);
                queue.push(nextBus);
              });
            }
          }

          const resolveBranchResult = (edge) => {
            if (branchResults[edge.id]) return branchResults[edge.id];
            const sourceType = nodeTypeById.get(edge.source);
            const targetType = nodeTypeById.get(edge.target);
            const transformerNodeId =
              sourceType === 'transformer'
                ? edge.source
                : targetType === 'transformer'
                  ? edge.target
                  : null;
            return transformerNodeId ? branchResults[`line-${transformerNodeId}`] : null;
          };

          const resolveContributionKa = (branch) => {
            const candidates = [
              Number(branch?.current_ka),
              Number(branch?.from_current_ka),
              Number(branch?.to_current_ka),
              Number(branch?.contribution_ka),
              Number(branch?.ikss_ka),
              Number(branch?.from_ikss_ka),
              Number(branch?.to_ikss_ka)
            ].filter((value) => Number.isFinite(value) && value > 0);
            if (candidates.length === 0) return null;
            return Math.max(...candidates);
          };

          const resolveContributionDirection = (branch) => {
            const fromBus = branch?.from_bus_id;
            const toBus = branch?.to_bus_id;
            if (!fromBus || !toBus) return null;

            const fromDistance = busDistanceToFault.get(fromBus);
            const toDistance = busDistanceToFault.get(toBus);
            let towardBus = null;

            if (Number.isFinite(fromDistance) && Number.isFinite(toDistance) && fromDistance !== toDistance) {
              towardBus = fromDistance < toDistance ? fromBus : toBus;
            } else if (fromBus === faultBusId) {
              towardBus = fromBus;
            } else if (toBus === faultBusId) {
              towardBus = toBus;
            }

            if (towardBus === fromBus) {
              return { fromId: toBus, toId: fromBus };
            }
            if (towardBus === toBus) {
              return { fromId: fromBus, toId: toBus };
            }
            return null;
          };

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
                    faultVoltageKv: voltageKv,
                    faultCurrentLabel: currentTypeLabel
                  }
                };
              }
              return {
                ...node,
                data: {
                  ...node.data,
                  isFaulted: false,
                  faultCurrentKa: undefined,
                  faultVoltageKv: undefined,
                  faultCurrentLabel: undefined,
                  loadFlowCurrentKa: undefined,
                  loadFlowVoltageKv: undefined,
                  loadFlowIncomingCurrentKa: undefined,
                  loadFlowOutgoingCurrentKa: undefined
                }
              };
            })
          );
          setEdges((currentEdges) =>
            currentEdges.map((edge) => {
              const branchResult = resolveBranchResult(edge);
              const contributionKa = resolveContributionKa(branchResult);
              const hasBranchContribution = Number.isFinite(contributionKa) && contributionKa > 0;
              const sourceMotorContribution = motorContributions[edge.source];
              const targetMotorContribution = motorContributions[edge.target];
              const branchDirection = resolveContributionDirection(branchResult);
              const motorContribution =
                sourceMotorContribution && nodeTypeById.get(edge.target) === 'bus'
                  ? {
                      currentKa: Number(sourceMotorContribution.current_ka),
                      fromId: edge.source,
                      toId: edge.target
                    }
                  : targetMotorContribution && nodeTypeById.get(edge.source) === 'bus'
                    ? {
                        currentKa: Number(targetMotorContribution.current_ka),
                        fromId: edge.target,
                        toId: edge.source
                      }
                    : null;
              const hasMotorContribution =
                Number.isFinite(Number(motorContribution?.currentKa)) && Number(motorContribution?.currentKa) > 0;
              const sourceNodeType = nodeTypeById.get(edge.source);
              const targetNodeType = nodeTypeById.get(edge.target);
              const sourceNodeContribution =
                sourceNodeType === 'utility' && targetNodeType === 'bus'
                  ? { sourceId: edge.source, busId: edge.target }
                  : targetNodeType === 'utility' && sourceNodeType === 'bus'
                    ? { sourceId: edge.target, busId: edge.source }
                    : sourceNodeType === 'generator' && targetNodeType === 'bus'
                      ? { sourceId: edge.source, busId: edge.target }
                      : targetNodeType === 'generator' && sourceNodeType === 'bus'
                        ? { sourceId: edge.target, busId: edge.source }
                        : null;
              const derivedSourceContributionKa =
                !hasBranchContribution && !hasMotorContribution && sourceNodeContribution
                  ? currentEdges.reduce((best, candidateEdge) => {
                      if (candidateEdge.id === edge.id) return best;
                      if (
                        candidateEdge.source !== sourceNodeContribution.busId &&
                        candidateEdge.target !== sourceNodeContribution.busId
                      ) {
                        return best;
                      }

                      const candidateBranchResult = resolveBranchResult(candidateEdge);
                      const candidateDirection = resolveContributionDirection(candidateBranchResult);
                      if (!candidateDirection || candidateDirection.fromId !== sourceNodeContribution.busId) {
                        return best;
                      }

                      const candidateKa = resolveContributionKa(candidateBranchResult);
                      if (!Number.isFinite(candidateKa) || candidateKa <= 0) return best;
                      return Math.max(best, candidateKa);
                    }, 0)
                  : 0;
              const hasSourceContribution =
                Number.isFinite(Number(derivedSourceContributionKa)) && Number(derivedSourceContributionKa) > 0;
              const effectiveContributionKa = hasBranchContribution
                ? contributionKa
                : hasMotorContribution
                  ? Number(motorContribution.currentKa)
                  : hasSourceContribution
                    ? Number(derivedSourceContributionKa)
                  : null;
              const effectiveDirection = hasBranchContribution
                ? branchDirection
                : hasMotorContribution
                  ? { fromId: motorContribution.fromId, toId: motorContribution.toId }
                  : hasSourceContribution
                    ? { fromId: sourceNodeContribution.sourceId, toId: sourceNodeContribution.busId }
                  : null;
              const hasDirection = Boolean(effectiveDirection?.fromId && effectiveDirection?.toId);
              const contributesToFaultBus = hasDirection && effectiveDirection.toId === faultBusId;
              const edgeTouchesFaultSide =
                hasDirection &&
                (edge.source === effectiveDirection.toId || edge.target === effectiveDirection.toId);
              const isSourceEdgeContribution = hasSourceContribution && Boolean(sourceNodeContribution);
              const shouldShowContributionLabel =
                effectiveContributionKa != null &&
                (contributesToFaultBus ? edgeTouchesFaultSide : isSourceEdgeContribution);
              const fromPos = hasDirection ? nodes.find((node) => node.id === effectiveDirection.fromId)?.position : null;
              const toPos = hasDirection ? nodes.find((node) => node.id === effectiveDirection.toId)?.position : null;
              const dx = (toPos?.x || 0) - (fromPos?.x || 0);
              const dy = (toPos?.y || 0) - (fromPos?.y || 0);
              const vectorMagnitude = Math.hypot(dx, dy);
              const labelOffsetDistance = hasBranchContribution
                ? 15
                : hasMotorContribution
                  ? 50
                  : hasSourceContribution
                    ? 42
                  : 28;
              const labelOffsetX =
                vectorMagnitude > 0 ? (dx / vectorMagnitude) * labelOffsetDistance : 0;
              const labelOffsetY =
                vectorMagnitude > 0 ? (dy / vectorMagnitude) * labelOffsetDistance : 0;
              const arrowGlyph =
                Math.abs(dy) >= Math.abs(dx)
                  ? dy >= 0
                    ? '\u2193'
                    : '\u2191'
                  : dx >= 0
                    ? '\u2192'
                    : '\u2190';
              return {
                ...edge,
                label:
                  shouldShowContributionLabel
                    ? `${arrowGlyph} ${formatCurrentFromKa(effectiveContributionKa)}`
                    : undefined,
                labelStyle:
                  shouldShowContributionLabel
                    ? {
                        color: '#b42318',
                        fill: '#b42318',
                        fontWeight: 700,
                        fontSize: 14,
                        transform: `translate(${labelOffsetX}px, ${labelOffsetY}px)`
                      }
                    : undefined,
                labelShowBg: false,
                style:
                  shouldShowContributionLabel
                    ? { stroke: '#8a8f98', strokeWidth: 2.4 }
                    : { stroke: '#b8bec7', strokeWidth: 3 },
                markerStart: undefined,
                markerEnd: undefined
              };
            })
          );
        } else {
          const busResults = response.data?.buses || {};
          const lineResults = response.data?.lines || {};
          const loadResults = response.data?.loads || {};
          const generatorResults = response.data?.generators || {};

          setNodes((currentNodes) => {
            const typeById = new Map(currentNodes.map((node) => [node.id, node.type]));
            const busCurrentTotals = new Map();

            const getLineCurrentFromResult = (lineResult) =>
              Math.max(Math.abs(Number(lineResult?.i_from_ka || 0)), Math.abs(Number(lineResult?.i_to_ka || 0)));

            const getEdgeCurrent = (edge) => {
              const directLineResult = lineResults[edge.id];
              if (directLineResult) {
                return getLineCurrentFromResult(directLineResult);
              }

              const sourceType = typeById.get(edge.source);
              const targetType = typeById.get(edge.target);

              const transformerNodeId =
                sourceType === 'transformer'
                  ? edge.source
                  : targetType === 'transformer'
                    ? edge.target
                    : null;
              if (transformerNodeId && lineResults[`line-${transformerNodeId}`]) {
                return getLineCurrentFromResult(lineResults[`line-${transformerNodeId}`]);
              }

              if (LOAD_FLOW_NODE_TYPES.has(sourceType)) {
                return Math.abs(
                  Number(loadResults[edge.source]?.current_ka || generatorResults[edge.source]?.current_ka || 0)
                );
              }
              if (LOAD_FLOW_NODE_TYPES.has(targetType)) {
                return Math.abs(
                  Number(loadResults[edge.target]?.current_ka || generatorResults[edge.target]?.current_ka || 0)
                );
              }
              return 0;
            };

            const nodesWithMetrics = currentNodes.map((node) => {
              if (node.type === 'bus') {
                return {
                  ...node,
                  data: {
                    ...node.data,
                    isFaulted: false,
                    faultCurrentKa: undefined,
                    faultVoltageKv: undefined,
                    faultCurrentLabel: undefined,
                    loadFlowVoltageKv: busResults[node.id]?.vm_kv ?? undefined,
                    loadFlowCurrentKa: undefined,
                    loadFlowIncomingCurrentKa: 0,
                    loadFlowOutgoingCurrentKa: 0
                  }
                };
              }

              if (node.type === 'load' || node.type === 'resistive_load') {
                const entry = loadResults[node.id];
                const currentKa = entry?.current_ka;
                const voltageKv = entry?.voltage_kv;
                return {
                  ...node,
                  data: {
                    ...node.data,
                    loadFlowCurrentKa: currentKa,
                    loadFlowVoltageKv: voltageKv
                  }
                };
              }

              if (node.type === 'generator' || node.type === 'utility') {
                const entry = generatorResults[node.id];
                const currentKa = entry?.current_ka;
                const voltageKv = entry?.voltage_kv;
                return {
                  ...node,
                  data: {
                    ...node.data,
                    loadFlowCurrentKa: currentKa,
                    loadFlowVoltageKv: voltageKv
                  }
                };
              }

              if (node.type === 'transformer') {
                const lineEntry = lineResults[`line-${node.id}`];
                const currentKa = lineEntry ? getLineCurrentFromResult(lineEntry) : undefined;
                const voltageKv =
                  lineEntry?.from_bus_id && busResults[lineEntry.from_bus_id]?.vm_kv != null
                    ? busResults[lineEntry.from_bus_id].vm_kv
                    : lineEntry?.to_bus_id && busResults[lineEntry.to_bus_id]?.vm_kv != null
                      ? busResults[lineEntry.to_bus_id].vm_kv
                      : undefined;
                return {
                  ...node,
                  data: {
                    ...node.data,
                    loadFlowCurrentKa: currentKa,
                    loadFlowVoltageKv: voltageKv
                  }
                };
              }

              return node;
            });

            edges.forEach((edge) => {
              const currentKa = getEdgeCurrent(edge);
              if (!Number.isFinite(currentKa) || currentKa <= 0) return;

              if (typeById.get(edge.source) === 'bus') {
                const existing = busCurrentTotals.get(edge.source) || { incoming: 0, outgoing: 0 };
                existing.outgoing += currentKa;
                busCurrentTotals.set(edge.source, existing);
              }
              if (typeById.get(edge.target) === 'bus') {
                const existing = busCurrentTotals.get(edge.target) || { incoming: 0, outgoing: 0 };
                existing.incoming += currentKa;
                busCurrentTotals.set(edge.target, existing);
              }
            });

            return nodesWithMetrics.map((node) => {
              if (node.type !== 'bus') return node;
              const totals = busCurrentTotals.get(node.id) || { incoming: 0, outgoing: 0 };
              return {
                ...node,
                data: {
                  ...node.data,
                  loadFlowIncomingCurrentKa: totals.incoming,
                  loadFlowOutgoingCurrentKa: totals.outgoing
                }
              };
            });
          });

          setEdges((currentEdges) =>
            currentEdges.map((edge) => {
              const directLineResult = lineResults[edge.id];
              const sourceNode = nodes.find((node) => node.id === edge.source);
              const targetNode = nodes.find((node) => node.id === edge.target);
              const transformerNodeId =
                sourceNode?.type === 'transformer'
                  ? sourceNode.id
                  : targetNode?.type === 'transformer'
                    ? targetNode.id
                    : null;
              const transformerLineResult = transformerNodeId ? lineResults[`line-${transformerNodeId}`] : null;
              const componentCurrent =
                loadResults[edge.source]?.current_ka ||
                generatorResults[edge.source]?.current_ka ||
                loadResults[edge.target]?.current_ka ||
                generatorResults[edge.target]?.current_ka;
              const lineCurrent =
                directLineResult || transformerLineResult
                  ? Math.max(
                      Math.abs(Number((directLineResult || transformerLineResult)?.i_from_ka || 0)),
                      Math.abs(Number((directLineResult || transformerLineResult)?.i_to_ka || 0))
                    )
                  : Number(componentCurrent || 0);
              const hasCurrentLabel = Number.isFinite(lineCurrent) && lineCurrent > 0;
              return {
                ...edge,
                label: hasCurrentLabel ? `I ${formatCurrentFromKa(lineCurrent)}` : undefined,
                labelStyle: undefined,
                labelShowBg: undefined,
                markerStart: undefined,
                markerEnd: undefined,
                style: { stroke: '#b8bec7', strokeWidth: 3 }
              };
            })
          );
        }
        setResult(response.data);
      } catch (err) {
        setError(err.response?.data?.detail || err.message);
      }
    },
    [
      mapToPayload,
      shortCircuitFaultBusId,
      shortCircuitFaultType,
      shortCircuitCurrentType,
      clearLoadFlowAnnotations,
      edges,
      nodes
    ]
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
    const normalizedEdges = graphEdges.map(({ selected, label, ...edge }) => ({
      ...edge,
      label: typeof label === 'string' || typeof label === 'number' ? label : undefined
    }));
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
    const busX = 320;
    const busCenterX = busX + 110;
    const symbolWidth = 92;
    const symbolX = (centerX) => centerX - symbolWidth / 2;

    const templateNodes = [
      { id: 'bus-1', type: 'bus', position: { x: busX, y: 150 }, data: { label: 'Bus 1', vn_kv: 33 } },
      { id: 'bus-2', type: 'bus', position: { x: busX, y: 365 }, data: { label: 'Bus 2', vn_kv: 11 } },
      {
        id: 'load-1',
        type: 'load',
        position: { x: symbolX(busX + 18), y: 530 },
        data: { label: 'Motor A', kv: 11, p_mw: 4, pf: 0.94 }
      },
      {
        id: 'load-2',
        type: 'load',
        position: { x: symbolX(busCenterX), y: 530 },
        data: { label: 'Motor B', kv: 11, p_mw: 3.2, pf: 0.95 }
      },
      {
        id: 'resistive-load-1',
        type: 'resistive_load',
        position: { x: symbolX(busX + 202), y: 530 },
        data: { label: 'Resistive A', p_mw: 1.2 }
      },
      {
        id: 'utility-1',
        type: 'utility',
        position: { x: symbolX(busCenterX), y: 20 },
        data: { label: 'Utility', mvasc: 1000, vm_pu: 1.0, p_mw: 0 }
      },
      {
        id: 'transformer-1',
        type: 'transformer',
        position: { x: symbolX(busCenterX), y: 245 },
        data: {
          label: 'TX 1',
          hv_kv: 33,
          lv_kv: 11,
          mva_rating: 10,
          z_percent: 6,
          vector_group: 'Dyn11',
          xr_ratio: 10
        }
      }
    ];

    const templateEdges = [
      {
        id: 'e-util-b1',
        source: 'utility-1',
        target: 'bus-1',
        targetHandle: 'top-3',
        type: 'straight',
        markerStart: undefined,
        markerEnd: undefined,
        style: { stroke: '#b8bec7', strokeWidth: 3 }
      },
      {
        id: 'e-b1-tx',
        source: 'bus-1',
        target: 'transformer-1',
        sourceHandle: 'bottom-3',
        type: 'straight',
        markerStart: undefined,
        markerEnd: undefined,
        style: { stroke: '#b8bec7', strokeWidth: 3 }
      },
      {
        id: 'e-tx-b2',
        source: 'transformer-1',
        target: 'bus-2',
        targetHandle: 'top-3',
        type: 'straight',
        markerStart: undefined,
        markerEnd: undefined,
        style: { stroke: '#b8bec7', strokeWidth: 3 }
      },
      {
        id: 'e-b2-load1',
        source: 'bus-2',
        target: 'load-1',
        sourceHandle: 'bottom-0',
        type: 'straight',
        markerStart: undefined,
        markerEnd: undefined,
        style: { stroke: '#b8bec7', strokeWidth: 3 }
      },
      {
        id: 'e-b2-load2',
        source: 'bus-2',
        target: 'load-2',
        sourceHandle: 'bottom-3',
        type: 'straight',
        markerStart: undefined,
        markerEnd: undefined,
        style: { stroke: '#b8bec7', strokeWidth: 3 }
      },
      {
        id: 'e-b2-rload1',
        source: 'bus-2',
        target: 'resistive-load-1',
        sourceHandle: 'bottom-6',
        type: 'straight',
        markerStart: undefined,
        markerEnd: undefined,
        style: { stroke: '#b8bec7', strokeWidth: 3 }
      }
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

  useEffect(() => {
    try {
      const sanitizedGraph = sanitizeGraphForPersistence({ nodes, edges });
      window.localStorage.setItem(getStorageKey(studyType), JSON.stringify(sanitizedGraph));
    } catch {
      // Ignore storage failures (quota/full/private mode) and keep editor functional.
    }
  }, [studyType, nodes, edges]);

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
        <div className="canvas-demo-action">
          <button type="button" onClick={onLoadTemplate}>
            Load Demo Network
          </button>
        </div>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          defaultEdgeOptions={{
            type: 'straight',
            markerStart: undefined,
            markerEnd: undefined,
            style: { stroke: '#b8bec7', strokeWidth: 3 }
          }}
          connectionLineType={ConnectionLineType.Straight}
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
        shortCircuitCurrentType={shortCircuitCurrentType}
        onShortCircuitCurrentTypeChange={setShortCircuitCurrentType}
        shortCircuitFaultBusId={shortCircuitFaultBusId}
        onShortCircuitFaultBusIdChange={setShortCircuitFaultBusId}
      />
    </div>
  );
}

import { Handle, Position } from 'reactflow';

function NodeShell({ className, data, children }) {
  const hasFaultResult = Boolean(data?.faultCurrentKa != null && data?.faultVoltageKv != null);

  return (
    <div className={`symbol-node ${className}`}>
      <Handle type="target" position={Position.Top} className="symbol-handle" />
      <Handle type="source" position={Position.Bottom} className="symbol-handle" />
      <div className="symbol-icon">{children}</div>
      <div className="symbol-label">{data.label}</div>
      {hasFaultResult && (
        <div className="fault-metrics">
          <div>Isc: {Number(data.faultCurrentKa).toFixed(3)} kA</div>
          <div>Vn: {Number(data.faultVoltageKv).toFixed(3)} kV</div>
        </div>
      )}
    </div>
  );
}

export function BusNode({ data }) {
  const handleOffsets = [10, 24, 38, 52, 66, 80, 94];
  const hasFaultResult = data?.faultCurrentKa != null && data?.faultVoltageKv != null;

  return (
    <div className={`bus-node ${data.isFaulted ? 'symbol-node--faulted' : ''}`}>
      {handleOffsets.map((left, index) => (
        <Handle
          key={`t-${left}`}
          id={`top-${index}`}
          type="target"
          position={Position.Top}
          className="symbol-handle bus-handle"
          style={{ left: `${left}%` }}
        />
      ))}
      {handleOffsets.map((left, index) => (
        <Handle
          key={`b-${left}`}
          id={`bottom-${index}`}
          type="source"
          position={Position.Bottom}
          className="symbol-handle bus-handle"
          style={{ left: `${left}%` }}
        />
      ))}
      <div className="bus-rail" />
      <div className="bus-meta">
        <div className="symbol-label">{data.label}</div>
        <div className="bus-kv">{Number(data.vn_kv || 0).toFixed(1)} kV</div>
      </div>
      {hasFaultResult && (
        <div className="fault-metrics fault-metrics--bus-side">
          <div>Isc {Number(data.faultCurrentKa).toFixed(3)} kA</div>
          <div>Vn {Number(data.faultVoltageKv).toFixed(3)} kV</div>
        </div>
      )}
    </div>
  );
}

export function LoadNode({ data }) {
  return (
    <NodeShell className="symbol-node--load" data={data}>
      <svg viewBox="0 0 80 44" aria-label="motor symbol">
        <circle cx="40" cy="22" r="16" fill="none" stroke="currentColor" strokeWidth="3" />
        <path
          d="M31 30V14l9 10l9-10v16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </NodeShell>
  );
}

export function GeneratorNode({ data }) {
  return (
    <NodeShell className="symbol-node--generator" data={data}>
      <svg viewBox="0 0 80 44" aria-label="generator symbol">
        <circle cx="40" cy="22" r="16" fill="none" stroke="currentColor" strokeWidth="3" />
        <path
          d="M28 22c2.8-6.7 6.2-6.7 9 0s6.2 6.7 9 0s6.2-6.7 9 0"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
    </NodeShell>
  );
}

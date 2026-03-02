import { Handle, Position } from 'reactflow';

function getRatingItems(type, data) {
  if (!data) return [];

  if (type === 'bus') {
    return [{ label: 'Vn', value: `${Number(data.vn_kv || 0).toFixed(1)} kV` }];
  }

  if (type === 'load') {
    return [
      { label: 'P', value: `${Number(data.p_mw || 0).toFixed(2)} MW` },
      { label: 'Q', value: `${Number(data.q_mvar || 0).toFixed(2)} MVAr` }
    ];
  }

  if (type === 'resistive_load') {
    return [
      { label: 'P', value: `${Number(data.p_mw || 0).toFixed(2)} MW` },
      { label: 'Q', value: `${Number(data.q_mvar || 0).toFixed(2)} MVAr` }
    ];
  }

  if (type === 'generator') {
    return [
      { label: 'P', value: `${Number(data.p_mw || 0).toFixed(2)} MW` },
      { label: 'V', value: `${Number(data.vm_pu || 0).toFixed(2)} pu` }
    ];
  }

  if (type === 'utility') {
    return [
      { label: 'P', value: `${Number(data.p_mw || 0).toFixed(2)} MW` },
      { label: 'V', value: `${Number(data.vm_pu || 0).toFixed(2)} pu` }
    ];
  }

  if (type === 'transformer') {
    return [
      { label: 'HV', value: `${Number(data.hv_kv || 0).toFixed(1)} kV` },
      { label: 'LV', value: `${Number(data.lv_kv || 0).toFixed(1)} kV` }
    ];
  }

  return [];
}

function NodeShell({
  className,
  data,
  children,
  showRating = false,
  ratingItems = [],
  allowTopTarget = true,
  allowBottomSource = true
}) {
  const hasFaultResult = Boolean(data?.faultCurrentKa != null && data?.faultVoltageKv != null);
  const hasRatings = showRating && ratingItems.length > 0;

  return (
    <div className={`symbol-node ${className}`}>
      <div className="symbol-anchor">
        {allowTopTarget && <Handle type="target" position={Position.Top} className="symbol-handle" />}
        {allowBottomSource && (
          <Handle type="source" position={Position.Bottom} className="symbol-handle" />
        )}
        {allowTopTarget && <div className="symbol-connector symbol-connector--top" />}
        {allowBottomSource && <div className="symbol-connector symbol-connector--bottom" />}
        <div className="symbol-icon">{children}</div>
        {hasRatings && (
          <div className="symbol-ratings">
            {ratingItems.map((item) => (
              <div className="symbol-rating" key={`${item.label}-${item.value}`}>
                <span>{item.label}:</span> <span>{item.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
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
  const handleOffsets = [8, 22, 36, 50, 64, 78, 92];
  const hasFaultResult = data?.faultCurrentKa != null && data?.faultVoltageKv != null;
  const isFaultHighlighted = Boolean(data?.isFaulted || data?.isFaultSelected);

  return (
    <div className={`bus-node ${isFaultHighlighted ? 'symbol-node--faulted' : ''}`}>
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

export function LoadNode({ data, showRating = false }) {
  return (
    <NodeShell
      className="symbol-node--load"
      data={data}
      showRating={showRating}
      ratingItems={getRatingItems('load', data)}
      allowBottomSource={false}
    >
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

export function GeneratorNode({ data, showRating = false }) {
  return (
    <NodeShell
      className="symbol-node--generator"
      data={data}
      showRating={showRating}
      ratingItems={getRatingItems('generator', data)}
      allowTopTarget={false}
    >
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

export function UtilityNode({ data, showRating = false }) {
  return (
    <NodeShell
      className="symbol-node--utility"
      data={data}
      showRating={showRating}
      ratingItems={getRatingItems('utility', data)}
      allowTopTarget={false}
    >
      <svg viewBox="0 0 80 44" aria-label="utility grid symbol">
        <path
          d="M22 10h36L40 36z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.7"
          strokeLinejoin="round"
        />
        <path d="M30 33h20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    </NodeShell>
  );
}

export function ResistiveLoadNode({ data, showRating = false }) {
  return (
    <NodeShell
      className="symbol-node--resistive-load"
      data={data}
      showRating={showRating}
      ratingItems={getRatingItems('resistive_load', data)}
      allowBottomSource={false}
    >
      <svg viewBox="0 0 80 44" aria-label="resistive load symbol">
        <rect x="24" y="8" width="32" height="28" fill="none" stroke="currentColor" strokeWidth="2.4" />
        <path
          d="M40 12v20M28 22h24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </svg>
    </NodeShell>
  );
}

export function TransformerNode({ data, showRating = false }) {
  return (
    <NodeShell
      className="symbol-node--transformer"
      data={data}
      showRating={showRating}
      ratingItems={getRatingItems('transformer', data)}
    >
      <svg viewBox="0 0 80 44" aria-label="transformer symbol">
        <path d="M40 3v9" fill="none" stroke="currentColor" strokeWidth="2.3" />
        <path d="M40 32v9" fill="none" stroke="currentColor" strokeWidth="2.3" />
        <circle cx="40" cy="15.5" r="7.5" fill="none" stroke="currentColor" strokeWidth="2.4" />
        <circle cx="40" cy="28.5" r="7.5" fill="none" stroke="currentColor" strokeWidth="2.4" />
      </svg>
    </NodeShell>
  );
}

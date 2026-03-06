import { Handle, Position } from 'reactflow';
import { formatCurrentFromKa, formatVoltageFromKv } from '../utils/unitFormat';

const numberFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2
});

function formatValue(value, fallback = 0) {
  const numericValue = Number(value ?? fallback);
  return numberFormatter.format(Number.isFinite(numericValue) ? numericValue : fallback);
}

function getRatingItems(type, data) {
  if (!data) return [];

  if (type === 'bus') {
    return [{ label: 'Vn', value: `${formatValue(data.vn_kv)} kV` }];
  }

  if (type === 'load') {
    return [
      { label: 'P', value: `${formatValue(data.p_mw)} MW` },
      { label: 'kV', value: `${formatValue(data.kv)} kV` },
      { label: 'pf', value: formatValue(data.pf) }
    ];
  }

  if (type === 'resistive_load') {
    return [{ label: 'P', value: `${formatValue(data.p_mw)} MW` }];
  }

  if (type === 'generator') {
    return [
      { label: 'P', value: `${formatValue(data.p_mw)} MW` },
      { label: 'V', value: `${formatValue(data.vm_pu)} pu` }
    ];
  }

  if (type === 'utility') {
    return [{ label: 'MVAsc', value: `${formatValue(data.mvasc)} MVA` }];
  }

  if (type === 'transformer') {
    return [
      { label: 'HV', value: `${formatValue(data.hv_kv)} kV` },
      { label: 'LV', value: `${formatValue(data.lv_kv)} kV` },
      { label: 'MVA', value: `${formatValue(data.mva_rating)} MVA` },
      { label: '%Z', value: `${formatValue(data.z_percent, 6)} %` },
      { label: 'VG', value: data.vector_group || '-' },
      { label: 'X/R', value: formatValue(data.xr_ratio) }
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
  const hasLoadFlowResult = Boolean(
    data?.loadFlowCurrentKa != null || data?.loadFlowVoltageKv != null
  );
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
          <div>{data?.faultCurrentLabel || 'Isc'}: {formatCurrentFromKa(data.faultCurrentKa)}</div>
          <div>Vn: {formatVoltageFromKv(data.faultVoltageKv)}</div>
        </div>
      )}
      {hasLoadFlowResult && (
        <div className="loadflow-metrics">
          {data?.loadFlowCurrentKa != null && (
            <div>I: {formatCurrentFromKa(data.loadFlowCurrentKa)}</div>
          )}
          {data?.loadFlowVoltageKv != null && (
            <div>V: {formatVoltageFromKv(data.loadFlowVoltageKv)}</div>
          )}
        </div>
      )}
    </div>
  );
}

export function BusNode({ data }) {
  const handleOffsets = [8, 22, 36, 50, 64, 78, 92];
  const hasFaultResult = data?.faultCurrentKa != null && data?.faultVoltageKv != null;
  const hasBusLoadFlowData = Boolean(
    data?.loadFlowVoltageKv != null ||
      data?.loadFlowIncomingCurrentKa != null ||
      data?.loadFlowOutgoingCurrentKa != null
  );
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
        <div className="bus-kv">{formatValue(data.vn_kv)} kV</div>
      </div>
      {hasBusLoadFlowData && (
        <>
          <div className="bus-current bus-current--incoming">
            I in: {formatCurrentFromKa(data.loadFlowIncomingCurrentKa)}
          </div>
          <div className="bus-current bus-current--outgoing">
            I out: {formatCurrentFromKa(data.loadFlowOutgoingCurrentKa)}
          </div>
          <div className="loadflow-metrics loadflow-metrics--bus-right">
            V: {formatVoltageFromKv(data.loadFlowVoltageKv)}
          </div>
        </>
      )}
      {hasFaultResult && (
        <div className="fault-metrics fault-metrics--bus-side">
          <div>{data?.faultCurrentLabel || 'Isc'} {formatCurrentFromKa(data.faultCurrentKa)}</div>
          <div>Vn {formatVoltageFromKv(data.faultVoltageKv)}</div>
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

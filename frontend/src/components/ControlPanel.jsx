import { useMemo, useState } from 'react';
import { formatCurrentFromKa, formatVoltageFromKv } from '../utils/unitFormat';

const PROTECTION_DEVICE_TYPE_OPTIONS = [
  { value: 'oc_relay', label: 'Overcurrent Relay' },
  { value: 'recloser', label: 'Recloser' },
  { value: 'fuse', label: 'Fuse' }
];

const PROTECTION_CURVE_OPTIONS = [
  { value: 'iec_standard_inverse', label: 'IEC Standard Inverse' },
  { value: 'iec_very_inverse', label: 'IEC Very Inverse' },
  { value: 'ansi_moderately_inverse', label: 'ANSI Moderately Inverse' },
  { value: 'ansi_very_inverse', label: 'ANSI Very Inverse' },
  { value: 'ansi_k', label: 'ANSI K Fuse' }
];

const PROTECTION_ELIGIBLE_NODE_TYPES = new Set([
  'load',
  'resistive_load',
  'generator',
  'utility',
  'transformer'
]);

const PROTECTION_CURVE_STYLES = [
  { color: '#0f6d34', dasharray: '0' },
  { color: '#1d4ed8', dasharray: '10 6' },
  { color: '#b45309', dasharray: '4 4' },
  { color: '#7c3aed', dasharray: '12 5 3 5' },
  { color: '#be123c', dasharray: '2 5' },
  { color: '#0f766e', dasharray: '14 6' }
];

function clampLogDomain(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function formatProtectionCurrent(value) {
  if (!Number.isFinite(value) || value <= 0) return '-';
  return value >= 1000 ? `${(value / 1000).toFixed(2)} kA` : `${value.toFixed(0)} A`;
}

function formatProtectionTime(value) {
  if (!Number.isFinite(value) || value <= 0) return '-';
  if (value >= 1) return `${value.toFixed(2)} s`;
  if (value >= 0.1) return `${value.toFixed(3)} s`;
  return `${(value * 1000).toFixed(1)} ms`;
}

function formatProtectionSettingSource(curve) {
  const parts = [curve?.curve_family_label || curve?.curve_family || 'Curve'];
  if (Number.isFinite(Number(curve?.pickup_current_a))) {
    parts.push(`pickup ${formatProtectionCurrent(Number(curve.pickup_current_a))}`);
  }
  if (Number.isFinite(Number(curve?.time_dial))) {
    parts.push(`TD ${Number(curve.time_dial).toFixed(2)}`);
  }
  if (Number.isFinite(Number(curve?.instantaneous_pickup_a))) {
    parts.push(`inst ${formatProtectionCurrent(Number(curve.instantaneous_pickup_a))}`);
  }
  return parts.join(' | ');
}

function buildLogTicks(minValue, maxValue) {
  const safeMin = clampLogDomain(minValue, 1);
  const safeMax = clampLogDomain(maxValue, safeMin * 10);
  const ticks = [];
  const startDecade = Math.floor(Math.log10(safeMin));
  const endDecade = Math.ceil(Math.log10(safeMax));

  for (let exponent = startDecade; exponent <= endDecade; exponent += 1) {
    const value = 10 ** exponent;
    if (value >= safeMin * 0.999 && value <= safeMax * 1.001) {
      ticks.push(value);
    }
  }

  if (ticks.length === 0) {
    ticks.push(safeMin, safeMax);
  }

  return [...new Set(ticks)].sort((a, b) => a - b);
}

function ProtectionCurvesChart({ curves }) {
  const [activeCurveId, setActiveCurveId] = useState('');
  const [activePoint, setActivePoint] = useState(null);

  const chartData = useMemo(() => {
    const preparedCurves = curves
      .map((curve, index) => {
        const validPoints = Array.isArray(curve?.points)
          ? curve.points
              .map((point) => ({
                current_a: Number(point?.current_a),
                time_s: Number(point?.time_s),
                region: point?.region || 'curve'
              }))
              .filter((point) => Number.isFinite(point.current_a) && point.current_a > 0 && Number.isFinite(point.time_s) && point.time_s > 0)
          : [];

        if (validPoints.length === 0) return null;

        return {
          ...curve,
          chartId: `${curve.device_id || curve.asset_id || index}-${index}`,
          style: PROTECTION_CURVE_STYLES[index % PROTECTION_CURVE_STYLES.length],
          points: validPoints
        };
      })
      .filter(Boolean);

    const allPoints = preparedCurves.flatMap((curve) => curve.points);
    const currentValues = allPoints.map((point) => point.current_a);
    const timeValues = allPoints.map((point) => point.time_s);

    const minCurrent = Math.min(...currentValues);
    const maxCurrent = Math.max(...currentValues);
    const minTime = Math.min(...timeValues);
    const maxTime = Math.max(...timeValues);

    return {
      curves: preparedCurves,
      domain: {
        minCurrent: clampLogDomain(minCurrent / 1.25, 1),
        maxCurrent: clampLogDomain(maxCurrent * 1.15, 10),
        minTime: clampLogDomain(minTime / 1.35, 0.01),
        maxTime: clampLogDomain(maxTime * 1.35, 1)
      }
    };
  }, [curves]);

  if (chartData.curves.length === 0) {
    return <p className="result-empty">No time-current curve data was returned for this study.</p>;
  }

  const width = 720;
  const height = 420;
  const margin = { top: 24, right: 20, bottom: 52, left: 72 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const {
    minCurrent,
    maxCurrent,
    minTime,
    maxTime
  } = chartData.domain;
  const logMinCurrent = Math.log10(minCurrent);
  const logMaxCurrent = Math.log10(maxCurrent);
  const logMinTime = Math.log10(minTime);
  const logMaxTime = Math.log10(maxTime);
  const xTicks = buildLogTicks(minCurrent, maxCurrent);
  const yTicks = buildLogTicks(minTime, maxTime);

  const toX = (value) =>
    margin.left + ((Math.log10(value) - logMinCurrent) / (logMaxCurrent - logMinCurrent || 1)) * plotWidth;
  const toY = (value) =>
    margin.top + plotHeight - ((Math.log10(value) - logMinTime) / (logMaxTime - logMinTime || 1)) * plotHeight;

  return (
    <div className="protection-chart">
      <div className="protection-chart__header">
        <div>
          <h5>TCC Chart</h5>
          <p className="result-note">
            Log-log view of operating time against current for each accepted device.
          </p>
        </div>
        <div className="protection-chart__focus">
          {activePoint ? (
            <>
              <strong>{activePoint.deviceName}</strong>
              <span>{activePoint.settingSource}</span>
              <span>
                {formatProtectionCurrent(activePoint.currentA)} at {formatProtectionTime(activePoint.timeS)}
              </span>
            </>
          ) : (
            <>
              <strong>Hover a curve</strong>
              <span>Inspect current and time values from the chart.</span>
            </>
          )}
        </div>
      </div>

      <div className="protection-chart__frame">
        <svg
          className="protection-chart__svg"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="Protection coordination time-current characteristic chart"
        >
          <rect x="0" y="0" width={width} height={height} rx="16" fill="#ffffff" />

          {xTicks.map((tick) => {
            const x = toX(tick);
            return (
              <g key={`x-${tick}`}>
                <line
                  x1={x}
                  y1={margin.top}
                  x2={x}
                  y2={margin.top + plotHeight}
                  className="protection-chart__grid"
                />
                <text x={x} y={height - 20} textAnchor="middle" className="protection-chart__axis-label">
                  {formatProtectionCurrent(tick)}
                </text>
              </g>
            );
          })}

          {yTicks.map((tick) => {
            const y = toY(tick);
            return (
              <g key={`y-${tick}`}>
                <line
                  x1={margin.left}
                  y1={y}
                  x2={margin.left + plotWidth}
                  y2={y}
                  className="protection-chart__grid"
                />
                <text x={margin.left - 12} y={y + 4} textAnchor="end" className="protection-chart__axis-label">
                  {formatProtectionTime(tick)}
                </text>
              </g>
            );
          })}

          <line
            x1={margin.left}
            y1={margin.top + plotHeight}
            x2={margin.left + plotWidth}
            y2={margin.top + plotHeight}
            className="protection-chart__axis"
          />
          <line
            x1={margin.left}
            y1={margin.top}
            x2={margin.left}
            y2={margin.top + plotHeight}
            className="protection-chart__axis"
          />

          <text
            x={margin.left + plotWidth / 2}
            y={height - 6}
            textAnchor="middle"
            className="protection-chart__title"
          >
            Current
          </text>
          <text
            x="18"
            y={margin.top + plotHeight / 2}
            textAnchor="middle"
            transform={`rotate(-90 18 ${margin.top + plotHeight / 2})`}
            className="protection-chart__title"
          >
            Operating Time
          </text>

          {chartData.curves.map((curve) => {
            const path = curve.points
              .map((point, index) => `${index === 0 ? 'M' : 'L'} ${toX(point.current_a)} ${toY(point.time_s)}`)
              .join(' ');
            const isActive = !activeCurveId || activeCurveId === curve.chartId;

            return (
              <g key={curve.chartId}>
                <path
                  d={path}
                  fill="none"
                  stroke={curve.style.color}
                  strokeWidth={activeCurveId === curve.chartId ? 4 : 3}
                  strokeDasharray={curve.style.dasharray}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={isActive ? 1 : 0.24}
                  onMouseEnter={() => setActiveCurveId(curve.chartId)}
                  onMouseLeave={() => {
                    setActiveCurveId('');
                    setActivePoint(null);
                  }}
                >
                  <title>{`${curve.device_name}: ${formatProtectionSettingSource(curve)}`}</title>
                </path>
                {curve.points.map((point, index) => {
                  const isHighlighted =
                    activePoint?.curveId === curve.chartId &&
                    activePoint?.pointIndex === index;
                  return (
                    <circle
                      key={`${curve.chartId}-${point.current_a}-${point.time_s}-${index}`}
                      cx={toX(point.current_a)}
                      cy={toY(point.time_s)}
                      r={isHighlighted ? 5 : 3}
                      fill={curve.style.color}
                      stroke="#ffffff"
                      strokeWidth="1.5"
                      opacity={isActive ? 0.92 : 0.24}
                      onMouseEnter={() => {
                        setActiveCurveId(curve.chartId);
                        setActivePoint({
                          curveId: curve.chartId,
                          pointIndex: index,
                          currentA: point.current_a,
                          timeS: point.time_s,
                          deviceName: curve.device_name,
                          settingSource: formatProtectionSettingSource(curve)
                        });
                      }}
                      onMouseLeave={() => setActivePoint(null)}
                    >
                      <title>{`${curve.device_name}: ${formatProtectionCurrent(point.current_a)}, ${formatProtectionTime(point.time_s)}`}</title>
                    </circle>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="protection-chart__legend" role="list" aria-label="Protection device curve legend">
        {chartData.curves.map((curve) => {
          const style = curve.style;
          const isActive = !activeCurveId || activeCurveId === curve.chartId;
          return (
            <button
              key={curve.chartId}
              type="button"
              className={`protection-chart__legend-item${isActive ? '' : ' protection-chart__legend-item--muted'}`}
              onMouseEnter={() => setActiveCurveId(curve.chartId)}
              onMouseLeave={() => setActiveCurveId('')}
            >
              <span
                className="protection-chart__legend-swatch"
                style={{ '--curve-color': style.color, '--curve-dash': style.dasharray }}
              />
              <span>
                <strong>{curve.device_name}</strong>
                <span>{formatProtectionSettingSource(curve)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function getShortCircuitCurrentTag(fault) {
  if (!fault) return 'Isc';
  if (fault.standard === 'ansi' && fault.current_type === 'initial_symmetrical') return 'Isym';
  if (fault.current_result_key === 'ikss_ka') return 'Ikss';
  if (fault.current_result_key === 'ip_ka') return 'Ip';
  if (fault.current_result_key === 'ith_ka') return 'Ith';
  return 'Isc';
}

function formatBranchEndpoint(branches, branchId) {
  const branch = branches?.[branchId];
  if (!branch) return branchId;
  const fromBus = branch.from_bus_id || '?';
  const toBus = branch.to_bus_id || '?';
  return `${fromBus} -> ${toBus}`;
}

function renderShortCircuitResults(result) {
  const fault = result?.fault;
  const faultBus = result?.fault_bus;
  const limitations = Array.isArray(fault?.limitations) ? fault.limitations : [];
  const branches = Object.entries(result?.branches || {});
  const branchRows = branches
    .map(([branchId, branch]) => {
      const preferredValue =
        branch?.[branch?.result_key] ??
        branch?.current_ka ??
        branch?.contribution_ka ??
        branch?.from_current_ka ??
        branch?.to_current_ka;
      const numericValue = Number(preferredValue);
      return Number.isFinite(numericValue) && numericValue > 0
        ? {
            branchId,
            endpoint: formatBranchEndpoint(result?.branches, branchId),
            label: branch?.result_label || fault?.current_type_label || 'Short-circuit current',
            currentKa: numericValue
          }
        : {
            branchId,
            endpoint: formatBranchEndpoint(result?.branches, branchId),
            label: branch?.result_label || fault?.current_type_label || 'Short-circuit current',
            currentKa: null
          };
    })
    .slice(0, 8);
  const currentTag = getShortCircuitCurrentTag(fault);

  return (
    <div className="study-result study-result--shortcircuit">
      <h4>Short-Circuit Results</h4>
      <div className="result-summary-grid">
        <div>
          <span>Standard</span>
          <strong>{fault?.standard_label || 'Unknown'}</strong>
        </div>
        <div>
          <span>Current Type</span>
          <strong>
            {currentTag}
            {fault?.current_type_label ? ` - ${fault.current_type_label}` : ''}
          </strong>
        </div>
        <div>
          <span>Fault Bus</span>
          <strong>{fault?.bus_id || '-'}</strong>
        </div>
        <div>
          <span>Fault Current</span>
          <strong>
            {faultBus?.current_ka != null ? formatCurrentFromKa(faultBus.current_ka) : 'Not available'}
          </strong>
        </div>
        <div>
          <span>Voltage Base</span>
          <strong>
            {faultBus?.voltage_level_kv != null
              ? formatVoltageFromKv(faultBus.voltage_level_kv)
              : 'Not available'}
          </strong>
        </div>
      </div>

      {fault?.engine_note && <p className="result-note">{fault.engine_note}</p>}

      <div className="result-section">
        <h5>Branch Contributions</h5>
        {branchRows.length > 0 ? (
          <div className="result-list">
            {branchRows.map((branch) => (
              <div className="result-list-row" key={branch.branchId}>
                <div>
                  <strong>{branch.endpoint}</strong>
                  <span>{branch.label}</span>
                </div>
                <div>{branch.currentKa != null ? formatCurrentFromKa(branch.currentKa) : 'Not available'}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="result-empty">
            Branch contribution values were not returned for this study case.
          </p>
        )}
      </div>

      <div className="result-section">
        <h5>Limitations</h5>
        {limitations.length > 0 ? (
          <ul className="result-limitations">
            {limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="result-empty">No standard-specific limitations were reported for this result.</p>
        )}
      </div>
    </div>
  );
}

function renderProtectionResults(result, error, isLoading) {
  const devices = Array.isArray(result?.devices) ? result.devices : [];
  const curves = Array.isArray(result?.curves) ? result.curves : [];

  if (isLoading) {
    return (
      <div className="study-result study-result--protection">
        <h4>Protection Coordination Results</h4>
        <div className="result-state-card result-state-card--loading">
          <strong>Generating coordination curves</strong>
          <span>Solving the network and building device TCC points.</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="study-result study-result--protection">
        <h4>Protection Coordination Results</h4>
        <div className="result-state-card result-state-card--error">
          <strong>Protection coordination failed</strong>
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="study-result study-result--protection">
        <h4>Protection Coordination Results</h4>
        <div className="result-state-card">
          <strong>No coordination run yet</strong>
          <span>Configure at least one device, then run the study to render interactive TCC curves.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="study-result study-result--protection">
      <h4>Protection Coordination Results</h4>
      <p className="result-note">{result?.message || 'Protection coordination completed.'}</p>
      <div className="result-summary-grid">
        <div>
          <span>Status</span>
          <strong>{result?.status || 'Unknown'}</strong>
        </div>
        <div>
          <span>Configured Devices</span>
          <strong>{result?.summary?.device_count ?? devices.length}</strong>
        </div>
        <div>
          <span>Generated Curves</span>
          <strong>{result?.summary?.curve_count ?? curves.length}</strong>
        </div>
        <div>
          <span>Coordination Margin</span>
          <strong>{result?.summary?.coordination_margin_s ?? '-'} s</strong>
        </div>
      </div>
      <div className="result-section">
        <h5>Device Curve Inputs</h5>
        {devices.length > 0 ? (
          <div className="result-list">
            {devices.map((device) => (
              <div className="result-list-row" key={`${device.asset_id}-${device.name}`}>
                <div>
                  <strong>{device.name}</strong>
                  <span>
                    {device.device_type} on {device.asset_id} at {device.bus_id} ({device.curve_family})
                  </span>
                </div>
                <div>
                  {device.pickup_current_a} A pickup / {device.max_fault_current_a} A fault / {device.curve_points_count} pts
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="result-empty">No protection devices were accepted.</p>
        )}
      </div>
      <div className="result-section">
        <ProtectionCurvesChart curves={curves} />
      </div>
    </div>
  );
}

export default function ControlPanel({
  studyType,
  onRunLoadFlow,
  onRunShortCircuit,
  selectedNode,
  onUpdateNode,
  selectedNodesCount,
  selectedEdgesCount,
  result,
  error,
  busCount,
  busNodes,
  shortCircuitStandard,
  onShortCircuitStandardChange,
  shortCircuitFaultType,
  onShortCircuitFaultTypeChange,
  shortCircuitCurrentType,
  onShortCircuitCurrentTypeChange,
  shortCircuitFaultBusId,
  onShortCircuitFaultBusIdChange,
  onRunProtection,
  protectionDeviceCount,
  isStudyRunning
}) {
  const isLoadFlow = studyType === 'loadflow';
  const isShortCircuit = studyType === 'shortcircuit';
  const isProtection = studyType === 'protection';
  const selectedNodeSupportsProtection = selectedNode && PROTECTION_ELIGIBLE_NODE_TYPES.has(selectedNode.type);
  const protection = selectedNodeSupportsProtection ? selectedNode.data.protection || {} : null;
  const protectionEnabled = Boolean(protection?.enabled);

  const updateProtection = (field, value) => {
    if (!selectedNodeSupportsProtection) return;
    onUpdateNode('protection', {
      phase_mode: 'phase',
      device_type: 'oc_relay',
      curve_family: 'iec_standard_inverse',
      pickup_current_a: '',
      time_dial: '',
      instantaneous_pickup_a: '',
      clearing_time_adder_s: 0,
      name: `${selectedNode.data.label} Relay`,
      ...(selectedNode.data.protection || {}),
      [field]: value
    });
  };

  const panelTitle = isLoadFlow
    ? 'Load Flow Settings'
    : isShortCircuit
      ? 'Short Circuit Settings'
      : 'Protection Coordination Settings';

  return (
    <section className="controls">
      <h3>{panelTitle}</h3>
      <p>Buses: {busCount}/20</p>
      <p>Selected: {selectedNodesCount} nodes, {selectedEdgesCount} connectors</p>
      <div className="buttons">
        {isLoadFlow && <button onClick={onRunLoadFlow}>Run Load Flow</button>}
        {isShortCircuit && <button onClick={onRunShortCircuit}>Run Short Circuit</button>}
        {isProtection && <button onClick={onRunProtection}>Run Protection Coordination</button>}
      </div>

      {isShortCircuit && (
        <div className="editor">
          <h4>Short Circuit Setup</h4>
          <label>
            Calculation Standard
            <select
              value={shortCircuitStandard}
              onChange={(e) => onShortCircuitStandardChange(e.target.value)}
            >
              <option value="ansi">ANSI</option>
              <option value="iec_60909">IEC 60909</option>
            </select>
          </label>
          <label>
            Fault Type
            <select
              value={shortCircuitFaultType}
              onChange={(e) => onShortCircuitFaultTypeChange(e.target.value)}
            >
              <option value="three_phase">Three Phase</option>
              <option value="single_phase">Single Phase</option>
              <option value="earth_fault">Earth Fault</option>
            </select>
          </label>
          <label>
            Faulted Bus
            <select
              value={shortCircuitFaultBusId}
              onChange={(e) => onShortCircuitFaultBusIdChange(e.target.value)}
              disabled={busNodes.length === 0}
            >
              <option value="">
                {busNodes.length === 0 ? 'No buses available' : 'Select a bus'}
              </option>
              {busNodes.map((busNode) => (
                <option key={busNode.id} value={busNode.id}>
                  {busNode.data.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Current Required
            <select
              value={shortCircuitCurrentType}
              onChange={(e) => onShortCircuitCurrentTypeChange(e.target.value)}
            >
              <option value="initial_symmetrical">Initial symmetrical current</option>
              <option value="peak">Peak short-circuit current</option>
              <option value="thermal_equivalent">Thermal equivalent current</option>
            </select>
          </label>
        </div>
      )}

      {isProtection && (
        <div className="editor">
          <h4>Protection Setup</h4>
          <p>
            Attach relays, reclosers, or fuses to loads, sources, and transformers, then run the
            coordination study to generate time-current curve data from the drawn network.
          </p>
          <p>Configured devices: {protectionDeviceCount}</p>
        </div>
      )}

      {selectedNode && (
        <div className="editor">
          <h4>Edit {selectedNode.data.label}</h4>
          {selectedNode.type === 'bus' && (
            <>
              <label>
                Name
                <input
                  value={selectedNode.data.label}
                  onChange={(e) => onUpdateNode('label', e.target.value)}
                />
              </label>
              <label>
                Voltage (kV)
                <input
                  type="number"
                  step="0.01"
                  value={selectedNode.data.vn_kv}
                  onChange={(e) => onUpdateNode('vn_kv', Number(e.target.value))}
                />
              </label>
            </>
          )}
          {selectedNode.type === 'load' && (
            <>
              <label>
                Motor Name
                <input
                  value={selectedNode.data.label}
                  onChange={(e) => onUpdateNode('label', e.target.value)}
                />
              </label>
              <label>
                Motor kV
                <input
                  type="number"
                  step="0.01"
                  value={selectedNode.data.kv}
                  onChange={(e) => onUpdateNode('kv', Number(e.target.value))}
                />
              </label>
              <label>
                Motor P (MW)
                <input
                  type="number"
                  step="0.01"
                  value={selectedNode.data.p_mw}
                  onChange={(e) => onUpdateNode('p_mw', Number(e.target.value))}
                />
              </label>
              <label>
                Motor pf
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  value={selectedNode.data.pf}
                  onChange={(e) => onUpdateNode('pf', Number(e.target.value))}
                />
              </label>
            </>
          )}

          {selectedNode.type === 'resistive_load' && (
            <>
              <label>
                Load Name
                <input
                  value={selectedNode.data.label}
                  onChange={(e) => onUpdateNode('label', e.target.value)}
                />
              </label>
              <label>
                P (MW)
                <input
                  type="number"
                  step="0.01"
                  value={selectedNode.data.p_mw}
                  onChange={(e) => onUpdateNode('p_mw', Number(e.target.value))}
                />
              </label>
            </>
          )}

          {selectedNode.type === 'generator' && (
            <>
              <label>
                Name
                <input
                  value={selectedNode.data.label}
                  onChange={(e) => onUpdateNode('label', e.target.value)}
                />
              </label>
              <label>
                P (MW)
                <input
                  type="number"
                  step="0.01"
                  value={selectedNode.data.p_mw}
                  onChange={(e) => onUpdateNode('p_mw', Number(e.target.value))}
                />
              </label>
              <label>
                Vm (pu)
                <input
                  type="number"
                  step="0.01"
                  value={selectedNode.data.vm_pu}
                  onChange={(e) => onUpdateNode('vm_pu', Number(e.target.value))}
                />
              </label>
            </>
          )}


          {selectedNode.type === 'utility' && (
            <>
              <label>
                Name
                <input
                  value={selectedNode.data.label}
                  onChange={(e) => onUpdateNode('label', e.target.value)}
                />
              </label>
              <label>
                MVAsc (MVA)
                <input
                  type="number"
                  step="0.01"
                  value={selectedNode.data.mvasc}
                  onChange={(e) => onUpdateNode('mvasc', Number(e.target.value))}
                />
              </label>
            </>
          )}

          {selectedNode.type === 'transformer' && (
            <>
              <label>
                Name
                <input
                  value={selectedNode.data.label}
                  onChange={(e) => onUpdateNode('label', e.target.value)}
                />
              </label>
              <label>
                HV (kV)
                <input
                  type="number"
                  step="0.01"
                  value={selectedNode.data.hv_kv}
                  onChange={(e) => onUpdateNode('hv_kv', Number(e.target.value))}
                />
              </label>
              <label>
                LV (kV)
                <input
                  type="number"
                  step="0.01"
                  value={selectedNode.data.lv_kv}
                  onChange={(e) => onUpdateNode('lv_kv', Number(e.target.value))}
                />
              </label>
              <label>
                Rating (MVA)
                <input
                  type="number"
                  step="0.01"
                  value={selectedNode.data.mva_rating}
                  onChange={(e) => onUpdateNode('mva_rating', Number(e.target.value))}
                />
              </label>
              <label>
                %Z
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={selectedNode.data.z_percent ?? 6}
                  onChange={(e) => onUpdateNode('z_percent', Number(e.target.value))}
                />
              </label>
              <label>
                Vector Group
                <input
                  value={selectedNode.data.vector_group}
                  onChange={(e) => onUpdateNode('vector_group', e.target.value)}
                />
              </label>
              <label>
                X/R Ratio
                <input
                  type="number"
                  step="0.01"
                  value={selectedNode.data.xr_ratio}
                  onChange={(e) => onUpdateNode('xr_ratio', Number(e.target.value))}
                />
              </label>
            </>
          )}

          {selectedNodeSupportsProtection && (
            <>
              <h4>Protection Device</h4>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={protectionEnabled}
                  onChange={(e) =>
                    onUpdateNode('protection', {
                      phase_mode: 'phase',
                      device_type: 'oc_relay',
                      curve_family: 'iec_standard_inverse',
                      pickup_current_a: '',
                      time_dial: '',
                      instantaneous_pickup_a: '',
                      clearing_time_adder_s: 0,
                      name: `${selectedNode.data.label} Relay`,
                      ...(selectedNode.data.protection || {}),
                      enabled: e.target.checked
                    })
                  }
                />
                Enable protection device on this asset
              </label>
              {protectionEnabled && (
                <>
                  <label>
                    Device Name
                    <input
                      value={protection?.name ?? `${selectedNode.data.label} Relay`}
                      onChange={(e) => updateProtection('name', e.target.value)}
                    />
                  </label>
                  <label>
                    Device Type
                    <select
                      value={protection?.device_type ?? 'oc_relay'}
                      onChange={(e) => updateProtection('device_type', e.target.value)}
                    >
                      {PROTECTION_DEVICE_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Phase Mode
                    <select
                      value={protection?.phase_mode ?? 'phase'}
                      onChange={(e) => updateProtection('phase_mode', e.target.value)}
                    >
                      <option value="phase">Phase</option>
                      <option value="ground">Ground</option>
                    </select>
                  </label>
                  <label>
                    Curve Family
                    <select
                      value={protection?.curve_family ?? 'iec_standard_inverse'}
                      onChange={(e) => updateProtection('curve_family', e.target.value)}
                    >
                      {PROTECTION_CURVE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Pickup Current (A)
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={protection?.pickup_current_a ?? ''}
                      onChange={(e) =>
                        updateProtection(
                          'pickup_current_a',
                          e.target.value === '' ? '' : Number(e.target.value)
                        )
                      }
                    />
                  </label>
                  <label>
                    Time Dial
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={protection?.time_dial ?? ''}
                      onChange={(e) =>
                        updateProtection('time_dial', e.target.value === '' ? '' : Number(e.target.value))
                      }
                    />
                  </label>
                  <label>
                    Instantaneous Pickup (A)
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={protection?.instantaneous_pickup_a ?? ''}
                      onChange={(e) =>
                        updateProtection(
                          'instantaneous_pickup_a',
                          e.target.value === '' ? '' : Number(e.target.value)
                        )
                      }
                    />
                  </label>
                  <label>
                    Clearing Time Adder (s)
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={protection?.clearing_time_adder_s ?? 0}
                      onChange={(e) =>
                        updateProtection(
                          'clearing_time_adder_s',
                          e.target.value === '' ? '' : Number(e.target.value)
                        )
                      }
                    />
                  </label>
                </>
              )}
            </>
          )}
        </div>
      )}

      {!isProtection && error && <pre className="error">{error}</pre>}
      {isProtection ? (
        renderProtectionResults(result, error, isStudyRunning)
      ) : result ? (
        isShortCircuit ? (
          renderShortCircuitResults(result)
        ) : (
          <pre className="result">{JSON.stringify(result, null, 2)}</pre>
        )
      ) : null}
    </section>
  );
}

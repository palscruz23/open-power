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

function renderProtectionResults(result) {
  const devices = Array.isArray(result?.devices) ? result.devices : [];
  const curves = Array.isArray(result?.curves) ? result.curves : [];

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
        <h5>Generated Curves</h5>
        {curves.length > 0 ? (
          <div className="result-list">
            {curves.map((curve) => {
              const firstPoint = curve.points?.[0];
              const lastPoint = curve.points?.[curve.points.length - 1];
              return (
                <div className="result-list-row" key={`${curve.device_id}-${curve.device_name}`}>
                  <div>
                    <strong>{curve.device_name}</strong>
                    <span>
                      {curve.curve_family_label} on {curve.bus_id}
                    </span>
                  </div>
                  <div>
                    {firstPoint && lastPoint
                      ? `${firstPoint.current_a.toFixed(0)}-${lastPoint.current_a.toFixed(0)} A`
                      : 'No points'}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="result-empty">No time-current curve data was returned for this study.</p>
        )}
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
  protectionDeviceCount
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

      {error && <pre className="error">{error}</pre>}
      {result &&
        (isShortCircuit ? (
          renderShortCircuitResults(result)
        ) : isProtection ? (
          renderProtectionResults(result)
        ) : (
          <pre className="result">{JSON.stringify(result, null, 2)}</pre>
        ))}
    </section>
  );
}

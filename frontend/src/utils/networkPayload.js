const PROTECTION_ELIGIBLE_NODE_TYPES = new Set([
  'load',
  'resistive_load',
  'generator',
  'utility',
  'transformer'
]);

export function buildNetworkModel(nodes, edges, resolveConnectedBus) {
  const buses = nodes
    .filter((node) => node.type === 'bus')
    .map((node) => ({
      id: node.id,
      name: node.data.label,
      vn_kv: Number(node.data.vn_kv)
    }));

  const busSet = new Set(buses.map((bus) => bus.id));
  const busVoltageById = new Map(
    buses.map((bus) => [bus.id, Number.isFinite(Number(bus.vn_kv)) ? Number(bus.vn_kv) : 0])
  );

  const lines = edges
    .filter((edge) => busSet.has(edge.source) && busSet.has(edge.target))
    .map((edge, index) => ({
      id: edge.id || `line-${index + 1}`,
      from_bus: edge.source,
      to_bus: edge.target,
      length_km: 1,
      r_ohm_per_km: 0.642,
      x_ohm_per_km: 0.083,
      c_nf_per_km: 210,
      max_i_ka: 0.3
    }));

  const loads = nodes
    .filter((node) => node.type === 'load' || node.type === 'resistive_load')
    .map((node) => {
      const pMw = Number(node.data.p_mw);
      const pfRaw = Number(node.data.pf);
      const pf = Number.isFinite(pfRaw) && pfRaw > 0 && pfRaw <= 1 ? pfRaw : 1;
      const qFromPf = pMw * Math.tan(Math.acos(pf));

      return {
        id: node.id,
        bus: resolveConnectedBus(node.id),
        p_mw: pMw,
        q_mvar: node.type === 'resistive_load' ? 0 : qFromPf,
        load_type: node.type === 'load' ? 'motor' : 'static'
      };
    })
    .filter((load) => load.bus);

  const generators = nodes
    .filter((node) => node.type === 'generator' || node.type === 'utility')
    .map((node) => ({
      id: node.id,
      bus: resolveConnectedBus(node.id),
      p_mw: Number(node.data.p_mw),
      vm_pu: Number(node.data.vm_pu)
    }))
    .filter((generator) => generator.bus);

  const transformers = nodes
    .filter((node) => node.type === 'transformer')
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

  const protection_devices = nodes
    .filter(
      (node) => PROTECTION_ELIGIBLE_NODE_TYPES.has(node.type) && Boolean(node.data?.protection?.enabled)
    )
    .map((node) => {
      const protection = node.data?.protection || {};
      const pickupCurrentRaw = Number(protection.pickup_current_a);
      const timeDialRaw = Number(protection.time_dial);
      const instantaneousPickupRaw = Number(protection.instantaneous_pickup_a);
      const clearingTimeAdderRaw = Number(protection.clearing_time_adder_s);

      return {
        asset_id: node.id,
        asset_type: node.type,
        device_type: protection.device_type || 'oc_relay',
        name:
          typeof protection.name === 'string' && protection.name.trim().length > 0
            ? protection.name.trim()
            : `${node.data?.label || node.id} Relay`,
        settings: {
          phase_mode: protection.phase_mode || 'phase',
          curve_family:
            typeof protection.curve_family === 'string' ? protection.curve_family.trim() : '',
          pickup_current_a:
            Number.isFinite(pickupCurrentRaw) && pickupCurrentRaw > 0 ? pickupCurrentRaw : null,
          time_dial: Number.isFinite(timeDialRaw) && timeDialRaw > 0 ? timeDialRaw : null,
          instantaneous_pickup_a:
            Number.isFinite(instantaneousPickupRaw) && instantaneousPickupRaw > 0
              ? instantaneousPickupRaw
              : null,
          clearing_time_adder_s:
            Number.isFinite(clearingTimeAdderRaw) && clearingTimeAdderRaw >= 0
              ? clearingTimeAdderRaw
              : 0
        }
      };
    });

  return {
    buses,
    lines,
    transformers,
    loads,
    generators,
    protection_devices
  };
}

export function buildLoadFlowPayload(networkModel) {
  return {
    buses: networkModel.buses,
    lines: networkModel.lines,
    transformers: networkModel.transformers,
    loads: networkModel.loads,
    generators: networkModel.generators,
    protection_devices: networkModel.protection_devices
  };
}

export function buildShortCircuitPayload(networkModel, options) {
  return {
    ...buildLoadFlowPayload(networkModel),
    fault_bus_id: options.faultBusId,
    standard: options.standard,
    fault_type: options.faultType,
    current_type: options.currentType
  };
}

export function buildProtectionPayload(networkModel, options = {}) {
  return {
    ...buildLoadFlowPayload(networkModel),
    coordination_margin_s: options.coordinationMarginS
  };
}

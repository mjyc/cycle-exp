import xs from 'xstream';
import dropRepeats from 'xstream/extra/dropRepeats';
import pairwise from 'xstream/extra/pairwise';
import {createGraph} from './dagreD3';

export default function FSMViz(sources, options = {}) {
  const vdom$ = sources.DagreD3
    .filter(v => v.type === 'VDOM').map(v => v.value);

  const svgReadyFirst$ = !!options.svgReadyFirst$
    ? options.svgReadyFirst$
    : sources.DOM.select('svg.dagre-d3').element().take(1);
  const g$ = !!options.g$
    ? options.g$
    : sources.state.stream
      .filter(rs => !!rs.g)
      .map(rs => rs.g).take(1);
  const selectedStateId$ = !!options.selectedStateId$
    ? options.selectedStateId$
    : sources.DagreD3
      .filter(v => v.type === 'CLICK' && v.value.type === 'NODE')
      .map(v => v.value.value);
  const fsmStateId$ = !!options.fsmStateId$
    ? options.fsmStateId$
    : sources.state.stream
      .filter(rs => !!rs.stateStamped && !!rs.stateStamped.state)
      .compose(dropRepeats((rs1, rs2) =>
        rs1.stateStamped.stamp === rs2.stateStamped.stamp
      ))
      .map(rs => rs.stateStamped.state);

  const graph$ = g$
    .map(g => createGraph(g.states, g.edges)).take(1);
  const dagre$ = xs.merge(
    xs.combine(svgReadyFirst$, graph$).map(([_, graph]) => graph),
    xs.combine(selectedStateId$.startWith(null), graph$)
      .compose(pairwise)
      .map(([[prevSId, _], [sId, graph]]) => {
        prevSId !== null && graph.setNode(prevSId, {
          ...graph.node(prevSId),
          style: 'stroke: #333; fill: #fff',
        });
        return graph.setNode(sId, {
          ...graph.node(sId),
          style: 'stroke: #333; fill: #ef8a62',
        });
      }),
    xs.combine(fsmStateId$.startWith(null), graph$)
      .compose(pairwise)
      .map(([[prevSId, _], [sId, graph]]) => {
        prevSId !== null && graph.setNode(prevSId, {
          ...graph.node(prevSId),
          style: 'stroke: #333; fill: #fff',
        });
        return graph.setNode(sId, {
          ...graph.node(sId),
          style: 'stroke: #333; fill: #91bfdb',
        });
      }),
  );

  return {
    DOM: vdom$,
    DagreD3: dagre$,
    g: g$,
    selectedStateId: selectedStateId$,
  };
}
import xs from 'xstream';
import dagreD3 from 'dagre-d3'
import * as d3 from 'd3';
import {svg, h} from '@cycle/dom';
import {adapt} from '@cycle/run/lib/adapt';

export function createGraph(states, edges) {
  const g = new dagreD3.graphlib.Graph().setGraph({});
  states.map(state => g.setNode(state.id, {
    label: state.text || state.id,
    style: state.style || 'stroke: #333; fill: #fff;',
  }));
  edges.map(edge => {
    g.setEdge(edge.from, edge.to, {
      label: edge.text || edge.id,
      style: edge.style || 'stroke: #333; fill: none; stroke-width: 1.5px;',
    });
  });
  return g;
}

export function makeDagreD3Driver(options = {}) {
  const render = new dagreD3.render();
  const init = !!options.init ? options.init : (svg, g) => {
    svg.attr('width', g.graph().width + 20);
    const scale = 0.8;
    const xCenterOffset = (svg.attr('width') - g.graph().width * scale) / 2;
    svg.select('g')
      .attr('transform', `translate(${xCenterOffset}, 10)scale(${scale})`);
    svg.attr('height', g.graph().height * scale + 20);
    svg.attr('style', 'border: 1px solid #ccc');
  };

  const dagreD3Driver = (sink$) => {
    const source$ = xs.create();
    setTimeout(() => {
      source$.shamefullySendNext({type: 'VDOM', value: svg('.dagre-d3', [h('g')])});
    }, 0);
    const emitClicks = (inner) => {
      inner.selectAll('g.node').on('click', node => {
        source$.shamefullySendNext({
          type: 'CLICK',
          value: {
            type: 'NODE',
            value: node,
          },
        });
      });
    }
    const graph$ = sink$.filter(_ => !!document.querySelector('svg.dagre-d3'));
    graph$.take(1)
      .addListener({
        next: g => {
          const svg = d3.select('svg.dagre-d3');
          const inner = svg.select('g');
          render(inner, g);
          init(svg, g);
          emitClicks(inner);
          source$.shamefullySendNext({type: 'LOADED'});
        },
        error: err => console.error(err),
      });
    graph$.drop(1)
      .addListener({
        next: g => {
          const svg = d3.select('svg.dagre-d3');
          const inner = svg.select('g');
          render(inner, g);
          init(svg, g);
          emitClicks(inner);
        },
        error: err => console.error(err),
      });

    return adapt(source$);
  };
  return dagreD3Driver;
}
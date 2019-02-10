import Chart from 'chart.js'
import _ from 'chartjs-plugin-streaming';
import fromEvent from 'xstream/extra/fromEvent'

export function makeStreamingChartDriver(config) {
  let instance = null;  // lazy initialize chart on first stream event

  const createChart = (el) => {
    const ctx = el.getContext('2d');
    instance = new Chart(ctx, config);
  };

  const updateChart = (data) => {
    if (!instance) {
      console.warn('Chart is not initialized yet; skipping update');
      return;
    }
    // data = [data1, ..., dataN]
    // or data = [{data: data1, stamp: stamp1}, ..., {data: dataN, stamp: stampN}]
    data.map((d, i) => {
      // TODO: allow incoming data to be {data: ..., stamp: ...}
      instance.data.datasets[i].data.push({
        x: new Date().getTime(),
        y: d,
      });
    });

    instance.update({
      preservation: true
    });
  };

  const createEvent = (evName) => {
    if (!instance) {
      console.error('Chart is not initialized yet; returning null');
      return null;

    }
    return fromEvent(el, evName)
      .filter(() => instance)
      .map((ev) => instance.getElementsAtEvent(ev));
  };

  const streamingChartDriver = (sink$) => {
    sink$.filter(s => s.type === 'CREATE').addListener({
      next: s => createChart(s.value),
    });
    sink$.filter(s => s.type === 'UPDATE').addListener({
      next: s => updateChart(s.value),
    });

    return {
      events: createEvent,
    };
  };
  return streamingChartDriver;
}

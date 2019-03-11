import xs from 'xstream';
import dropRepeats from 'xstream/extra/dropRepeats';
import isolate from '@cycle/isolate';
import {SpeakWithScreenAction, selectActionResult} from '@cycle-robot-drivers/actionbank';
import {Status, isEqualGoal, initGoal} from '@cycle-robot-drivers/action';

// FSM types
export const S = {
  WAIT: 'S0',
  ENGAGE: 'S1',
}

const SIGType = {
  ENGAGE_START: 'ENGAGE_START',
  ENGAGE_DONE: 'ENGAGE_DONE',
}

function createInput({
  transitionParameters = {},
  enableOverideEngage = false,
} = {}) {
  const theta_fs = typeof transitionParameters.theta_fs === 'undefined'
    ? 1000 : transitionParameters.theta_fs;

  const input = (
    twoSpeechbubblesResult$,
    actionResult$,
  ) => {
    const theta_fs = typeof transitionParameters.theta_fs === 'undefined'
    ? 1000 : transitionParameters.theta_fs;

    return xs.merge(
      twoSpeechbubblesResult$
        .filter(r => (
          r.status.status === Status.SUCCEEDED
          && r.result === 'Hello'
        )).mapTo({type: SIGType.ENGAGE_START}),
      actionResult$
        .filter(r => r.status.status === Status.SUCCEEDED)
        .mapTo({type: SIGType.ENGAGE_DONE}),
    );
  };

  return input;
}

function createReducer(options = {}) {
  const reducer = (input$) => {
    const initReducer = xs.of((prev) => {
      if (typeof prev === 'undefined') {
        return {
          stateStamped: {
            state: S.WAIT,
            stamp: Date.now(),
          },
          outputs: null,
          g: {
            states: [
              {id: 'S0', text: 'WAIT'},
              {id: 'S1', text: 'ENGAGE'},
            ],
            edges: [
              {from: 'S0', to: 'S1', text: SIGType.ENGAGE_START},
              {from: 'S1', to: 'S0', text: SIGType.ENGAGE_DONE},
            ],
          },
        };
      } else {
        return prev;
      }
    });

    const transitionReducer = input$.map(input => prev => {
      // console.debug('input', input, 'prev', prev);
      if (
        prev.stateStamped.state === S.WAIT && input.type === SIGType.ENGAGE_START
      ) {
        return {
          ...prev,
          stateStamped: {
            state: S.ENGAGE,
            stamp: Date.now(),
          },
          outputs: {
            ...options.getEngageOutput(prev, input),
          },
        };
      } else if (
        prev.stateStamped.state === S.ENGAGE && input.type === SIGType.ENGAGE_DONE
      ) {
        return {
          ...prev,
          stateStamped: {
            state: S.WAIT,
            stamp: Date.now(),
          },
          outputs: {
            MonologueAction: {goal: initGoal('Bye now!')},
            ...options.getDisengageOutput(prev, input),
          },
        };
      }
      return prev;
    });

    return xs.merge(initReducer, transitionReducer);
  }
  return reducer;
};

function output(reducerState$) {
  const outputs$ = reducerState$
    .filter(rs => !!rs.outputs)
    .map(rs => rs.outputs);
  return {
    result: outputs$
      .filter(o => !!o.result)
      .map(o => o.result),
    MonologueAction: outputs$
      .filter(o => !!o.MonologueAction)
      .map(o => o.MonologueAction.goal)
      .compose(dropRepeats(isEqualGoal)),
  };
};

export default function withGreeting(main, options = {}) {
  if (!options.getEngageOutput)
    options.getEngageOutput = () => null;
  if (!options.getDisengageOutput)
    options.getDisengageOutput = () => null;
  if (!options.getMaintainOutput)
    options.getMaintainOutput = () => null;
  if (!options.getReengageOutput)
    options.getReengageOutput = () => null;
  if (typeof options.enableOverideEngage === 'undefined')
    options.enableOverideEngage = false;
  if (typeof options.enableOverideDisengage === 'undefined')
    options.enableOverideDisengage = false;
  if (typeof options.enableOverideHold === 'undefined')
    options.enableOverideHold = false;

  const mainWithGreeting = (sources) => {
    // sources.state.stream.addListener({next: rs => console.debug('reducerState', rs)});
    const reducerState$ = sources.state.stream;
    const outputs = output(reducerState$);
    const mnSinks = isolate(SpeakWithScreenAction, 'SpeakWithScreenAction')({
      goal: outputs.MonologueAction,
      TwoSpeechbubblesAction: {result: sources.TwoSpeechbubblesAction.result},
      SpeechSynthesisAction: {result: sources.SpeechSynthesisAction.result},
      state: sources.state,
    });

    const twoSpeechbubblesResult$ = reducerState$.compose(selectActionResult('TwoSpeechbubblesAction'));
    const mainSinks = main(sources);
    const input = createInput(options);
    const input$ = input(
      twoSpeechbubblesResult$,
      mainSinks.result || xs.never(),
    );
    const reducer = createReducer(options);
    const parentReducer$ = reducer(input$);
    const reducer$ = xs.merge(
      parentReducer$,
      mnSinks.state,
      mainSinks.state || xs.never(),
    );

    const twoSpeechbubblesGoal$ = xs.merge(
      sources.TabletFace.load.mapTo(initGoal({
        message: 'Hello there!',
        choices: ['Hello'],
      })),
      mnSinks.TwoSpeechbubblesAction,
      mainSinks.TwoSpeechbubblesAction || xs.never(),
    );
    const speechSynthesisGoal$ = xs.merge(
      mnSinks.SpeechSynthesisAction,
      mainSinks.SpeechSynthesisAction || xs.never(),
    );
    return {
      ...mainSinks,
      TwoSpeechbubblesAction: twoSpeechbubblesGoal$,
      SpeechSynthesisAction: speechSynthesisGoal$,
      PoseDetection: xs.of({
        algorithm: 'single-pose',
        singlePoseDetection: {minPoseConfidence: 0.2},
        fps: 5,
      }),
      state: reducer$,
    };
  };

  return mainWithGreeting;
}

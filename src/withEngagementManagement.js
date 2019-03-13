import xs from 'xstream';
import dropRepeats from 'xstream/extra/dropRepeats';
import isolate from '@cycle/isolate';
import {SpeakWithScreenAction} from '@cycle-robot-drivers/actionbank';
import {Status, isEqualGoal, initGoal} from '@cycle-robot-drivers/action';

// FSM types
export const S = {
  WAIT: 'S0',
  ENGAGE: 'S1',
  MAINTAIN: 'S2',
}

const SIGType = {
  POSES: 'POSES',
  ENGAGE_START: 'ENGAGE_START',
  ENGAGE_DONE: 'ENGAGE_DONE',
  MAINTAIN_START: 'MAINTAIN_START',
  MAINTAIN_DONE: 'MAINTAIN_DONE',
  BYE_DONE: 'BYE_DONE',
}

function createInput({
  transitionParameters = {},
  enableOverideEngage = false,
} = {}) {
  const theta_fs = typeof transitionParameters.theta_fs === 'undefined'
    ? 1000 : transitionParameters.theta_fs;

  const input = (
    poses$,
    actionResult$,
    features$,
    twoSpeechbubblesResult$,
    speechSynthesisResult$
  ) => {
    return xs.merge(
      poses$
        .map(poses => ({type: SIGType.POSES, value: poses})),
      actionResult$
        .filter(r => r.status.status === Status.SUCCEEDED)
        .mapTo({type: SIGType.ENGAGE_DONE}),
      features$
        .filter(f => !!f.faceSize)
        .map(
          f => f.faceSize > theta_fs
            ? {type: SIGType.ENGAGE_START}
            : {type: SIGType.ENGAGE_DONE}
        ).compose(dropRepeats((a, b) => a.type === b.type)),
      //features$
      //  .filter(f => !!f.noseOrientation)
      //  .map(
      //    f => (f.noseOrientation > 1.9 || f.noseOrientation < 1.4)
      //      ? {type: SIGType.MAINTAIN_START}
      //      : {type: SIGType.MAINTAIN_DONE},
      //  ).compose(dropRepeats((a, b) => a.type === b.type)),
      enableOverideEngage
        ? twoSpeechbubblesResult$
          .filter(r => r.result === 'Hello!')
          .mapTo({
            type: SIGType.ENGAGE_START
          })
        : xs.never(),
      twoSpeechbubblesResult$
        .filter(r => r.status.status === Status.SUCCEEDED
          && (
            r.result === 'Pause'
            || r.result === 'Bye!'
            || r.result === 'Resume'
          )
        )
        .map(r => r.result === 'Pause'
          ? {type: SIGType.MAINTAIN_START}
          :  r.result === 'Bye!'
          ? {type: SIGType.ENGAGE_DONE}
          : {type: SIGType.MAINTAIN_DONE}
        ),
      speechSynthesisResult$  // TODO: make sure to get "bye now only"
        .filter(r => r.status.goal_id.id === 'bye-now')
        .mapTo({type: SIGType.BYE_DONE})
    );
  }
  return input;
}

function createReducer(options = {}) {
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

  const reducer = (input$) => {
    const initReducer = xs.of((prev) => {
      if (typeof prev === 'undefined') {
        return {
          stateStamped: {
            state: S.WAIT,
            stamp: Date.now(),
          },
          variables: {
            stamp: null,
            visibility: null,
            isVisible: null,
            faceSize: null,
            faceCenterX: null,
            faceCenterY: null,
            faceOrientation: null,
            noseOrientation: null,
          },
          outputs: options.enableOverideEngage ? {
            TwoSpeechbubblesAction: {goal: initGoal({
              message: '',
              choices: ['Hello!']
            })},
          } : null,
          g: {
            states: [
              {id: 'S0', text: 'WAIT'},
              {id: 'S1', text: 'ENGAGE'},
              {id: 'S2', text: 'MAINTAIN'},
            ],
            edges: [
              {from: 'S0', to: 'S1', text: SIGType.ENGAGE_START},
              {from: 'S1', to: 'S2', text: SIGType.MAINTAIN_START},
              {from: 'S1', to: 'S0', text: SIGType.ENGAGE_DONE},
              {from: 'S2', to: 'S1', text: SIGType.MAINTAIN_DONE},
              {from: 'S2', to: 'S0', text: SIGType.ENGAGE_DONE},
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
        prev.stateStamped.state === S.WAIT && input.type === SIGType.BYE_DONE
      ) {
        return {
          ...prev,
          outputs: options.enableOverideEngage ? {
            TwoSpeechbubblesAction: {goal: initGoal({
              message: '',
              choices: ['Hello!']
            })},
          } : null,
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
            MonologueAction: {goal: {
              goal_id: {
                stamp: new Date(),
                id: 'bye-now'
              },
              goal: 'Bye now!'
            }},
            ...options.getDisengageOutput(prev, input),
          },
        };
      } else if (
        prev.stateStamped.state === S.ENGAGE && input.type === SIGType.MAINTAIN_START
      ) {
        return {
          ...prev,
          stateStamped: {
            state: S.MAINTAIN,
            stamp: Date.now(),
          },
          outputs: {
            ...options.getMaintainOutput(prev, input),
          },
        };
      } else if (
        prev.stateStamped.state === S.MAINTAIN && input.type === SIGType.MAINTAIN_DONE
      ) {
        return {
          ...prev,
          stateStamped: {
            state: S.ENGAGE,
            stamp: Date.now(),
          },
          outputs: {
            ...options.getReengageOutput(prev, input),
          },
        };
      } else if (
        prev.stateStamped.state === S.MAINTAIN && input.type === SIGType.ENGAGE_DONE
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
      } else if (input.type ===  SIGType.POSES) {
        const poses = input.value;

        let stamp = Date.now();
        let isVisible = null;
        let faceSize = null;
        let faceCenterX = null;
        let faceCenterY = null;
        let faceOrientation = null;
        let noseOrientation = null;

        isVisible = poses.length === 1;
        if (!isVisible) {
          return {
            ...prev,
            variables: {
              stamp,
              isVisible,
              faceSize,
              faceCenterX,
              faceCenterY,
              faceOrientation,
              noseOrientation,
            },
          };
        }

        const person = poses[0];
        if (
          !person.keypoints.find(kpt => kpt.part === 'nose')
          || !person.keypoints.find(kpt => kpt.part === 'leftEye')
          || !person.keypoints.find(kpt => kpt.part === 'rightEye')
        ) {
          return {
            ...prev,
            variables: {
              stamp,
              isVisible,
              faceSize,
              faceCenterX,
              faceCenterY,
              faceOrientation,
              noseOrientation,
            },
          };
        }
        const ns = person.keypoints.filter(kpt => kpt.part === 'nose')[0].position;
        const le = person.keypoints.filter(kpt => kpt.part === 'leftEye')[0].position;
        const re = person.keypoints.filter(kpt => kpt.part === 'rightEye')[0].position;
        const dnsre = Math.sqrt(Math.pow(ns.x - le.x, 2) + Math.pow(ns.y - le.y, 2));
        const dnsle = Math.sqrt(Math.pow(ns.x - re.x, 2) + Math.pow(ns.y - re.y, 2));
        const drele = Math.sqrt(Math.pow(re.x - le.x, 2) + Math.pow(re.y - le.y, 2));
        const s = 0.5 * (dnsre + dnsle + drele);
        faceSize = Math.sqrt(s * (s - dnsre) * (s - dnsle) * (s - drele));

        faceCenterX = (ns.x + le.x + re.x) / 3;
        faceCenterY = (ns.y + le.y + re.y) / 3;

        const btnEyesPt = {
          x: (le.x + re.x) * 0.5,
          y: (le.y + re.y) * 0.5,
        };
        const v = {  // a vector from the point between two eyes to the nose
          x: ns.x - btnEyesPt.x,
          y: ns.y - btnEyesPt.y,
        };
        faceOrientation = Math.atan2(v.y, v.x);

        const dbere = Math.sqrt(Math.pow(btnEyesPt.x - re.x, 2) + Math.pow(btnEyesPt.y - re.y, 2));
        const dbens = Math.sqrt(Math.pow(ns.x - btnEyesPt.x, 2) + Math.pow(ns.y - btnEyesPt.y, 2));
        noseOrientation = Math.acos((Math.pow(dbere, 2) + Math.pow(dbens, 2) - Math.pow(dnsre, 2)) / (2 * dbere * dbens));

        return {
          ...prev,
          variables: {
            stamp,
            isVisible,
            faceSize,
            faceCenterX,
            faceCenterY,
            faceOrientation,
            noseOrientation,
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
    TwoSpeechbubblesAction: outputs$
      .filter(o => !!o.TwoSpeechbubblesAction)
      .map(o => o.TwoSpeechbubblesAction.goal)
      .compose(dropRepeats(isEqualGoal)),
  };
};

export default function withEngagementManagement(main, options = {}) {
  const mainWithEngagementManagement = (sources) => {
    // sources.state.stream.addListener({next: rs => console.debug('reducerState', rs)});
    const reducerState$ = sources.state.stream;
    const outputs = output(reducerState$)
    const mnSinks = isolate(SpeakWithScreenAction, 'SpeakWithScreenAction')({
      goal: outputs.MonologueAction,
      TwoSpeechbubblesAction: {result: sources.TwoSpeechbubblesAction.result},
      SpeechSynthesisAction: {result: sources.SpeechSynthesisAction.result},
      state: sources.state,
    });
    const mainSinks = main(sources);


    const features$ = reducerState$
      .filter(rs => !!rs.variables)
      .compose(dropRepeats((rs1, rs2) => rs1.variables.stamp === rs2.variables.stamp))
      .map(rs => rs.variables);
    const input = createInput(options);
    const input$ = input(
      sources.PoseDetection.poses,
      mainSinks.result || xs.never(),
      features$,
      sources.TwoSpeechbubblesAction.result,
      sources.SpeechSynthesisAction.result,
    );
    const reducer = createReducer(options);
    const parentReducer$ = reducer(input$);
    const reducer$ = xs.merge(
      parentReducer$,
      mnSinks.state,
      mainSinks.state || xs.never(),
    );

    let twoSpeechbubblesGoal$ = xs.merge(
      mnSinks.TwoSpeechbubblesAction,
      mainSinks.TwoSpeechbubblesAction || xs.never(),
      outputs.TwoSpeechbubblesAction,
    );
    if (!options.enableOverideDisengage) {
      twoSpeechbubblesGoal$ = twoSpeechbubblesGoal$.map(g => {
        if (typeof g.goal === 'object') {
          g.goal.choices = g.goal.choices.filter(choice => choice !== 'Bye!')
          return g;
        } else {
          return g;
        }
      });
    }
    if (!options.enableOverideHold) {
      twoSpeechbubblesGoal$ = twoSpeechbubblesGoal$.map(g => {
        if (typeof g.goal === 'object') {
          g.goal.choices = g.goal.choices.filter(choice => choice !== 'Pause' && choice !== 'Resume')
          return g;
        } else {
          return g;
        }
      });
    }

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

  return mainWithEngagementManagement;
}

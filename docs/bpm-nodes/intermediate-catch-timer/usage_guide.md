# Intermediate Catch Event (Timer) — usage guide

## 1. Details
BPMN element: `<bpmn2:intermediateCatchEvent>` with `<bpmn2:timerEventDefinition>`. Sits **in the
flow** (not on a border) and pauses the token until the timer elapses, then continues.

## 2. Usage
`pru-api-error-handler` uses `Timer_1mWait` (`PT1M`) as a back-off delay between retry attempts.

## 3. How / when to use
- Use for an unconditional wait/delay inside a sequence (throttle, back-off, cool-down).
- Different from a boundary timer: this always pauses the flow; a boundary timer races against
  an activity's completion.

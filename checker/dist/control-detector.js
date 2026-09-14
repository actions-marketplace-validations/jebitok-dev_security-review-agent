"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkControl = checkControl;
function signalPresentInLines(pattern, lines) {
    const regex = new RegExp(pattern);
    return lines.some((line) => regex.test(line));
}
function signalPresentInContent(pattern, content) {
    const regex = new RegExp(pattern, 'm');
    return regex.test(content);
}
function checkControl(surface, diffRecord) {
    const missingSignals = [];
    const triggeredAbsentSignals = [];
    // Deleted file means every control is gone
    if (diffRecord.status === 'deleted') {
        return {
            intact: false,
            missingSignals: surface.control.signals,
            triggeredAbsentSignals: [],
        };
    }
    for (const signal of surface.control.signals) {
        let stillPresent;
        if (diffRecord.fullNewContent !== undefined) {
            // Authoritative: check the entire post-change file
            stillPresent = signalPresentInContent(signal.pattern, diffRecord.fullNewContent);
        }
        else {
            // Heuristic: signal is removed if it appears in removedLines but not in addedLines
            // and not in unchanged context lines (lines with no prefix in the diff — not tracked here).
            // If a signal was never in removedLines, it wasn't touched → assume still present.
            const wasRemoved = signalPresentInLines(signal.pattern, diffRecord.removedLines);
            const wasAdded = signalPresentInLines(signal.pattern, diffRecord.addedLines);
            if (wasRemoved && !wasAdded) {
                stillPresent = false;
            }
            else {
                stillPresent = true;
            }
        }
        if (!stillPresent) {
            missingSignals.push(signal);
        }
    }
    for (const absentSignal of surface.control.absent_signals) {
        if (signalPresentInLines(absentSignal.pattern, diffRecord.addedLines)) {
            triggeredAbsentSignals.push(absentSignal);
        }
    }
    return {
        intact: missingSignals.length === 0 && triggeredAbsentSignals.length === 0,
        missingSignals,
        triggeredAbsentSignals,
    };
}

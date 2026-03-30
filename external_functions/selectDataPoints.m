function [x, y] = selectDataPoints(ax)
% Prefer the built-in ROI when available; otherwise capture one click
% directly from the containing UI figure so App Designer keeps working.
if exist('drawpoint', 'file') == 2 || exist('drawpoint', 'builtin') == 5
    try
        roi = drawpoint('Parent', ax);
        x = roi.Position(1);
        y = roi.Position(2);
        return
    catch
    end
end

fig = ancestor(ax, 'figure');
x = NaN;
y = NaN;
selection_completed = false;

oldPointer = fig.Pointer;
oldWindowButtonDownFcn = fig.WindowButtonDownFcn;
oldWindowKeyPressFcn = fig.WindowKeyPressFcn;

cleanupObj = onCleanup(@() restoreFigureCallbacks(fig, oldPointer, oldWindowButtonDownFcn, oldWindowKeyPressFcn)); %#ok<NASGU>

fig.Pointer = 'crosshair';
fig.WindowButtonDownFcn = @capturePoint;
fig.WindowKeyPressFcn = @cancelSelection;

uiwait(fig);

if ~selection_completed
    error('Point selection cancelled.');
end

    function capturePoint(~, ~)
        currentPoint = ax.CurrentPoint;
        candidate = currentPoint(1, 1:2);
        xLimits = xlim(ax);
        yLimits = ylim(ax);

        if candidate(1) < min(xLimits) || candidate(1) > max(xLimits) || ...
                candidate(2) < min(yLimits) || candidate(2) > max(yLimits)
            return
        end

        x = candidate(1);
        y = candidate(2);
        selection_completed = true;
        uiresume(fig);
    end

    function cancelSelection(~, event)
        if strcmp(event.Key, 'escape')
            uiresume(fig);
        end
    end
end

function restoreFigureCallbacks(fig, oldPointer, oldWindowButtonDownFcn, oldWindowKeyPressFcn)
if isvalid(fig)
    fig.Pointer = oldPointer;
    fig.WindowButtonDownFcn = oldWindowButtonDownFcn;
    fig.WindowKeyPressFcn = oldWindowKeyPressFcn;
end
end

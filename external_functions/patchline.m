function p = patchline(gca, xs,ys,varargin)


[zs,PVs] = parseInputs(varargin{:});
if rem(numel(PVs),2) ~= 0
    % Odd number of inputs!
    error('patchline: Parameter-Values must be entered in valid pairs')
end

% Facecolor = 'k' is (essentially) ignored here, but syntactically necessary
if isempty(zs)
    p = patch(gca, [xs(:);NaN],[ys(:);NaN],'k');
else
    p = patch(gca, [xs(:);NaN],[ys(:);NaN],[zs(:);NaN],'k');
end

% Apply PV pairs
for ii = 1:2:numel(PVs)
    set(p,PVs{ii},PVs{ii+1})
end
if nargout == 0
    clear p
end
end
function [zs,PVs] = parseInputs(varargin)
if isnumeric(varargin{1})
    zs = varargin{1};
    PVs = varargin(2:end);
else
    PVs = varargin;
    zs = [];
end
end
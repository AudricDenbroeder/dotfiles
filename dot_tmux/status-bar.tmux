# Status bar position at the top
set -g status-position top

# Nord palette colors
nord_active="#81a1c1"      # Nord frost blue (for active window)
nord_inactive="#4c566a"    # Nord comment grey (for inactive)
# Enable 2-line status bar (use 2, 3, 4, or 5 for more height)
set -g status 2

# Status bar styling (transparent background)
set -g status-style "bg=default,fg=default"

# Left side: session name | windows
set -g status-left " #[fg=$nord_active,bold]#S #[fg=$nord_inactive]| "
set -g status-left-length 20

# Right side: empty
set -g status-right ""

# Window separator in grey
set -g window-status-separator " "

# Active window: text color only (no background)
set -g window-status-current-format "#[fg=$nord_active,bold]#I:#W#[default]"

# Inactive windows: grey text
set -g window-status-format "#[fg=$nord_inactive]#I:#W#[default]"

# Empty second line for padding
set -g status-format[1] ""

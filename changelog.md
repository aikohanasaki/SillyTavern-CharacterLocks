# Changelog

All notable changes to the SillyTavern Model Temperature Locks extension will be documented in this file.

← [Back to README](README.md)

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.0.6] - 2025-01-15

### Added
- **Enhanced Group Chat UI**: Complete redesign of group chat interface to display ALL group members simultaneously
- **Responsive Group Member Layout**: Flexbox-based layout that displays group members side-by-side with automatic wrapping on smaller screens
- **Improved Group Chat Flow**: Reorganized settings display order (Group Settings → Chat Settings → Group Members)
- **User Guidance**: Added helpful tooltip directing users to character cards for individual character settings management
- **Large Scrollable Popup**: Enhanced popup size and scrolling capabilities for better group chat experience

### Changed
- **Group Chat Button Simplification**: Removed confusing "Set Active Char" and "Clear Active Char" buttons from group chat interface
- **Settings Display Reorganization**: Moved group members display to bottom after chat settings for better information hierarchy
- **Tooltip Positioning**: Moved instructional tooltip to bottom of interface, just before action buttons for better visibility
- **Popup Sizing**: Added large popup mode with vertical scrolling for improved content accessibility

### Fixed
- **Group Chat Settings Display**: Fixed issue where character settings were not displaying properly in group chats
- **Content Overflow**: Resolved popup content being cut off by implementing proper scrolling and sizing

### Technical
- Implemented `flex-container` and `flex1` CSS classes from SillyTavern's native styling system
- Added `large: true` and `allowVerticalScrolling: true` popup options for improved UX
- Enhanced settings loading logic to load all group members instead of single active character
- Updated Handlebars template to support multiple group member display
- Improved responsive design using SillyTavern's native CSS utilities

### Previous Features (from earlier versions)
- Preset switching functionality for automatic preset management
- Support for multiple AI model providers and completion sources
- Group chat individual temperature locks per character
- Enhanced model selector support for various providers
- Chat completion new sources and API integration improvements
- Model selector updates and compatibility improvements
- Completion source filtering behavior fixes
- Menu item display and interaction fixes

## [Previous Versions]

### Version History
- **095cb6f** - Add preset switching functionality
- **c4f496e** - Fix chat completion new sources and issues
- **f71ff33** - Update model selectors
- **93562b1** - Update model selectors (continued improvements)
- **21920dd** - Fix completion source filter
- **246e3c0** - Fix completion source filter (additional fixes)
- **1f99857** - Correct behavior improvements
- **02d8eaf** - Correct behavior (continued)
- **076448d** - Update readme documentation
- **6bce75a** - Reduce logging verbosity
- **d6e0e21** - Implement group chat individual temp locks
- **02a1e89** - Banking functionality additions
- **c1f5631** - Testing character integration in group chats
- **d9934eb** - Code cleanup and optimization
- **0cfdc9b** - Added comprehensive group chat support
- **1d97fac** - Small UI tweaks and improvements
- **6b3fdb6** - Add wrapping to UI controls
- **c18083d** - Component renaming
- **8b9a698** - Rename components and fix controls
- **6d26427** - Fix menu item functionality

---

*This changelog is automatically maintained. For more detailed information about changes, please refer to the git commit history.*
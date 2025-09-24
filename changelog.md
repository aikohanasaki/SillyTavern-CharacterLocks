# Changelog

← [Back to README](README.md)

## [4.0.0] - 2025-01-24

### 🚨 BREAKING CHANGES
- **Complete Architectural Redesign**: Evolved from model/temperature locks to comprehensive preset and profile management system
- **New Dependency**: Now requires Connection Manager extension to be enabled for full functionality
- **Changed Scope**: Extension now manages complete connection profiles and presets instead of just model/temperature settings
- **Updated Storage**: Settings storage mechanism updated to support new preset/profile architecture

### Added
- **Preset Management Integration**: Full integration with SillyTavern's preset management system
- **Connection Profile Switching**: Automatic switching and saving of connection profiles per character/chat
- **Enhanced Group Chat Support**: Individual character settings management within group conversations
- **Improved Auto-Save System**: Comprehensive auto-save functionality for both presets and profiles
- **Advanced Error Recovery**: Robust error handling with graceful fallbacks and recovery mechanisms
- **Streamlined Operations**: Optimized performance and reduced resource usage

### Changed
- **Core Functionality**: Transitioned from temperature/model locks to complete preset and profile management
- **User Interface**: Updated UI components to reflect new preset/profile management capabilities
- **Settings Architecture**: Redesigned settings storage and retrieval system for enhanced reliability
- **Extension Integration**: Improved integration with SillyTavern's native systems and APIs

## [3.1.0] - 2025-01-16

### Added
- **Enhanced Event Management System**: Comprehensive event handler registration and cleanup system with proper resource management
- **Queue Bounds Protection**: Added maximum queue sizes for character and context change queues to prevent memory issues
- **Timeout Protection**: 5-second timeout protection for context building operations to prevent deadlocks
- **Memory Leak Prevention**: Complete extension cleanup system with proper event listener disposal and resource management
- **Robust Error Handling**: Enhanced error handling throughout the extension with graceful degradation and recovery
- **Event Validation**: Pre-registration validation of events to ensure compatibility with different SillyTavern versions

### Changed
- **Race Condition Fixes**: Replaced busy-wait polling with promise-based coordination for context building
- **Improved Queue Processing**: Enhanced queue processing with proper debouncing (100ms) instead of recursive setTimeout
- **Better Async Handling**: All async operations now properly handled with comprehensive error boundaries
- **Enhanced DOM Safety**: Added validation and null checks for all DOM element operations with safe fallbacks

### Fixed
- **SillyTavern Compatibility**: Fixed non-existent `CHARACTER_SELECTED` event usage, now properly uses `CHAT_CHANGED` event
- **Invalid Completion Source**: Removed references to non-existent '01ai' completion source from selectors
- **Group Edit Integration**: Fixed `editGroup` function calls to use proper imports instead of window object access
- **Event Registration Failures**: Added fallback mechanisms for event registration with proper error handling
- **Context Building Concurrency**: Eliminated CPU-intensive busy-waiting with efficient promise-based approach

### Technical Improvements
- **Memory Management**: Bounded queues (max 10 character queue, 20 context queue) with FIFO overflow protection
- **Performance Optimization**: Eliminated busy-wait loops that consumed CPU during context building
- **Error Recovery**: Added comprehensive error boundaries with detailed logging and recovery mechanisms
- **Event System Robustness**: Enhanced event registration with validation, cleanup, and fallback handling
- **API Integration**: Improved validation for getCurrentApiInfo() and DOM element access with type checking
- **Function Signatures**: Enhanced async function handling with proper await patterns and error propagation

### Security & Stability
- **Input Validation**: Enhanced validation for all user inputs and API responses with sanitization
- **Safe Defaults**: Added safe default values for all settings operations to prevent undefined behavior
- **Resource Cleanup**: Proper cleanup of timers, promises, and event listeners to prevent memory leaks
- **Graceful Degradation**: Extension continues working even when some SillyTavern features are unavailable

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

*For more detailed information about changes, please refer to the git commit history.*
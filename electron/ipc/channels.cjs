/**
 * Single source of truth for IPC channel names (main + preload).
 * Keep main.cjs and preload.cjs in sync with these constants.
 */
'use strict';

module.exports = {
  RUN_COMMAND: 'run-command',
  RUN_COMMAND_STREAM: 'run-command-stream',
  WRITE_STREAM_STDIN: 'write-stream-stdin',
  KILL_STREAM: 'kill-stream',
  GET_PLATFORM: 'get-platform',
  FILE_EXISTS: 'file-exists',
  READ_FILE: 'read-file',
  WRITE_FILE: 'write-file',
  MKDIR: 'mkdir',
  GET_DISK_SPACE: 'get-disk-space',
  SELECT_FOLDER: 'select-folder',
  SECRETS_BACKEND: 'secrets-backend',
  SECRETS_LIST: 'secrets-list',
  SECRETS_GET: 'secrets-get',
  SECRETS_SET: 'secrets-set',
  SECRETS_DELETE: 'secrets-delete',
  SET_RUN_IN_BACKGROUND: 'set-run-in-background',
  QUIT_APP: 'quit-app',
  SET_AGENT_RUNNING_STATE: 'set-agent-running-state',
  COMMAND_OUTPUT: 'command-output',
  AGENT_RUNNING_CHANGED: 'agent-running-changed',
};

import {
  type CompanionCommand,
  type CompanionOpackMessage,
  type CompanionRequestOpackMessage,
  type CompanionResponseOpackMessage,
  type CompanionEventOpackMessage,
  createCompanionCommand,
  MessageType,
} from '@/protocols/companion/messages/CompanionOpackMessage.ts'

export interface LaunchAppRequestContent {
  _bundleID?: string
  _urlS?: string
}

export interface LaunchAppRequest extends CompanionRequestOpackMessage {
  _i: '_launchApp'
  _c: LaunchAppRequestContent
}

export interface LaunchAppResponse extends CompanionResponseOpackMessage {
  _i: '_launchApp'
  _c: {}
}

export interface FetchLaunchableApplicationsEventContent {
  [bundleId: string]: string // bundleId -> name
}

export interface FetchLaunchableApplicationsRequest extends CompanionRequestOpackMessage {
  _i: 'FetchLaunchableApplicationsEvent'
  _c: LaunchAppRequestContent
}

export interface FetchLaunchableApplicationsResponse extends CompanionResponseOpackMessage {
  _i: 'FetchLaunchableApplicationsEvent'
  _c: FetchLaunchableApplicationsEventContent
}

/**
 * Factory function for creating LaunchApp commands
 */
export function createLaunchAppCommand(
  bundleId?: string,
  url?: string
): CompanionCommand<LaunchAppRequest, LaunchAppResponse, void> {
  return createCompanionCommand({
    identifier: '_launchApp',
    name: `LaunchApp${bundleId ? `:${bundleId}` : ''}${url ? `:${url}` : ''}`,
    buildContent: () => ({
      ...(bundleId && { _bundleID: bundleId }),
      ...(url && { _urlS: url }),
    }),
    parse: () => undefined,
  })
}

export function createFetchLaunchableApplicationsCommand(): CompanionCommand<
  FetchLaunchableApplicationsRequest,
  FetchLaunchableApplicationsResponse,
  ParsedFetchLaunchableApplicationsEvent
> {
  return createCompanionCommand({
    identifier: 'FetchLaunchableApplicationsEvent',
    name: 'FetchLaunchableApplications',
    buildContent: () => ({}),
    parse: response => parseFetchLaunchableApplicationsEvent(response),
  })
}

export interface ParsedFetchLaunchableApplicationsEvent {
  type: 'fetch-applications'
  apps: { bundleId: string; name: string }[]
  count: number
  raw: FetchLaunchableApplicationsResponse
}

export function parseFetchLaunchableApplicationsEvent(
  message: FetchLaunchableApplicationsResponse
): ParsedFetchLaunchableApplicationsEvent {
  const apps = Object.entries(message._c).map(([bundleId, name]) => ({
    bundleId,
    name: name as string,
  }))
  return {
    type: 'fetch-applications',
    apps,
    count: apps.length,
    raw: message,
  }
}

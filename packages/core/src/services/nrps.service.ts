import type { BaseLogger } from 'pino';

import { LTI_NRPS_SCOPE_CONTEXT_MEMBERSHIP_READONLY } from '../constants.js';
import {
  LtiServiceError,
  summarizeLtiServiceResponseBody,
} from '../errors/ltiServiceError.js';
import type { LTISession } from '../interfaces/ltiSession.js';
import type { LTIStorage } from '../interfaces/ltiStorage.js';
import { getValidLaunchConfig } from '../utils/launchConfigValidation.js';
import { ltiServiceFetch } from '../utils/ltiServiceFetch.js';

import type { TokenService } from './token.service.js';

/**
 * Names and Role Provisioning Services (NRPS) implementation for LTI 1.3.
 * Provides methods to retrieve course membership and user information from the platform.
 *
 * @see https://www.imsglobal.org/spec/lti-nrps/v2p0
 */
export class NRPSService {
  /**
   * Creates a new NRPSService instance.
   *
   * @param tokenService - Token service for obtaining OAuth2 bearer tokens
   * @param storage - Storage adapter for retrieving launch configurations
   * @param logger - Logger instance for debug and error logging
   */
  constructor(
    private tokenService: TokenService,
    private storage: LTIStorage,
    private logger: BaseLogger,
  ) {}

  /**
   * Retrieves all members (users) in the current course/context from the platform.
   * Returns raw response that should be parsed by the calling service.
   *
   * @param session - Active LTI session used for token lookup
   * @param membershipUrl - Validated NRPS membership endpoint URL
   * @returns Promise resolving to the HTTP response containing membership data
   * @throws {LtiServiceError} When token lookup, transport, or platform response fails
   *
   * @example
   * ```typescript
   * const response = await nrpsService.getMembers(
   *   session,
   *   'https://platform.example.com/nrps/members'
   * );
   * const data = await response.json();
   * console.log('Course members:', data.members);
   * ```
   */
  async getMembers(session: LTISession, membershipUrl: string): Promise<Response> {
    const token = await this.getNRPSToken(
      session,
      LTI_NRPS_SCOPE_CONTEXT_MEMBERSHIP_READONLY,
    );

    const response = await ltiServiceFetch(membershipUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.ims.lti-nrps.v2.membershipcontainer+json',
      },
    });

    await this.validateNRPSResponse(response, 'get members');
    return response;
  }

  private async getNRPSToken(session: LTISession, scope: string): Promise<string> {
    const launchConfig = await getValidLaunchConfig(
      this.storage,
      session.platform.issuer,
      session.platform.clientId,
      session.platform.deploymentId,
    );

    return this.tokenService.getBearerToken(
      session.platform.clientId,
      launchConfig.tokenUrl,
      scope,
    );
  }

  private async validateNRPSResponse(
    response: Response,
    operation: string,
  ): Promise<void> {
    if (!response.ok) {
      const responseBodySummary = await summarizeLtiServiceResponseBody(response);
      this.logger.error(
        { responseBodySummary, status: response.status, statusText: response.statusText },
        `NRPS ${operation} failed`,
      );
      throw new LtiServiceError({
        code: 'platform_request_failed',
        serviceKind: 'nrps',
        operation,
        message: `NRPS ${operation} failed: ${response.status} ${response.statusText}`,
        endpointType: 'nrps',
        status: response.status,
        statusText: response.statusText,
        responseBodySummary,
      });
    }
  }
}

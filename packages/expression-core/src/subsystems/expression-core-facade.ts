import type { DynamicContractSnapshot, ExtensionCoreHost, ExtensionHostView } from "@ai0/extension-core";
import type {
  CommunicativeIntentEnvelope,
  DeliveryReceipt,
  ExpressionVocabulary,
  InteractionChannel,
  NegotiatedIntentDispatch
} from "@ai0/protocol";
import { InteractionOpportunityPool, type ExpressionClockPort } from "../kernel/opportunities.js";
import { GroundingReceiptTracker, type RecoveredInterruption } from "./grounding.js";
import {
  bindActuatorDelivery,
  RealizerVocabularyNegotiator,
  type EmbodiedPresentationStyle,
  type PresentationRenderer
} from "./realizer.js";

export interface ExpressionCoreOptions {
  readonly host?: ExtensionHostView;
  readonly clock?: ExpressionClockPort;
  readonly style?: Readonly<EmbodiedPresentationStyle>;
  readonly renderer?: PresentationRenderer;
}

/**
 * Cohesive ExpressionCore uniting lifecycle, dynamic extension/protocol loading,
 * privacy-fenced vocabulary negotiation, and four-stage delivery grounding receipts.
 */
export class ExpressionCore {
  readonly host?: ExtensionHostView;
  readonly negotiator: RealizerVocabularyNegotiator;
  readonly grounding: GroundingReceiptTracker;
  readonly opportunities?: InteractionOpportunityPool;

  private active = true;
  private unsubscribeHost?: () => void;

  constructor(options: ExpressionCoreOptions = {}) {
    this.host = options.host;
    this.negotiator = new RealizerVocabularyNegotiator(options.host, options.style, options.renderer);
    this.grounding = new GroundingReceiptTracker(options.host);
    if (options.clock) {
      this.opportunities = new InteractionOpportunityPool(options.clock);
    }
    const maybeCoreHost = options.host as Partial<ExtensionCoreHost> | undefined;
    if (typeof maybeCoreHost?.onDidChange === "function") {
      this.unsubscribeHost = maybeCoreHost.onDidChange(() => {
        // Realizers, decorators, transcoders, and dynamic expression_protocol contracts are resolved live per turn.
      });
    }
  }

  get isActive(): boolean {
    return this.active;
  }

  start(): void {
    this.active = true;
  }

  stop(): void {
    this.active = false;
  }

  dispose(): void {
    this.active = false;
    this.unsubscribeHost?.();
    this.unsubscribeHost = undefined;
  }

  mountChannel(channel: InteractionChannel): void {
    this.negotiator.mount(channel);
  }

  unmountChannel(channelId: string): void {
    this.negotiator.unmount(channelId);
  }

  mountMediaVocabulary(channelId: string, vocabulary: ExpressionVocabulary): void {
    this.negotiator.mountMediaVocabulary(channelId, vocabulary);
  }

  listDynamicProtocols(): readonly DynamicContractSnapshot[] {
    return this.host?.listDynamicContracts("expression_protocol") ?? [];
  }

  negotiateAndRecord(
    intent: CommunicativeIntentEnvelope,
    preferredChannelId?: string
  ): NegotiatedIntentDispatch {
    if (!this.active) {
      throw new Error("ExpressionCore is stopped");
    }
    const dispatch = this.negotiator.negotiate(intent, preferredChannelId);
    if (dispatch.status === "dispatched") {
      this.grounding.recordGenerated(dispatch.envelope);
    }
    return dispatch;
  }

  receiveReceipt(receipt: DeliveryReceipt): RecoveredInterruption | undefined {
    return this.grounding.receive(receipt);
  }

  bindActuator(packageId: string, channelId: string, permits: (actuatorId: string) => boolean) {
    if (!this.host) {
      throw new Error("ExtensionHostView is required to bind actuator delivery");
    }
    return bindActuatorDelivery(this.host, packageId, channelId, permits);
  }
}

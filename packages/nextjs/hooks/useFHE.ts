"use client";

import { useEffect, useMemo, useState } from "react";
import { Encryptable, Environment, FheTypes, Permit, fhe, permitStore } from "@luxfhe/sdk/web";
import { Address, Chain } from "viem";
import { arbitrum, arbitrumSepolia, hardhat, mainnet, sepolia, baseSepolia } from "viem/chains";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import scaffoldConfig from "~~/scaffold.config";

// Define types based on the store structure
type AccountRecord<T> = Record<Address, T>;
type ChainRecord<T> = Record<number, T>;

// Track initialization state globally
let isInitializedGlobally = false;

interface FHEConfig {
  environment: Environment;
  coFheUrl?: string;
  verifierUrl?: string;
  thresholdNetworkUrl?: string;
  ignoreErrors?: boolean;
  generatePermit?: boolean;
}

const ChainEnvironments = {
  // Ethereum
  [mainnet.id]: "MAINNET",
  // Arbitrum
  [arbitrum.id]: "MAINNET",
  // Ethereum Sepolia
  [sepolia.id]: "TESTNET",
  // Arbitrum Sepolia
  [arbitrumSepolia.id]: "TESTNET",
  // Base Sepolia
  [baseSepolia.id]: "TESTNET",
  // Hardhat
  [hardhat.id]: "MOCK",
} as const;

export const targetNetworksNoHardhat = scaffoldConfig.targetNetworks.filter(
  (network: Chain) => network.id !== hardhat.id,
);

export const useIsConnectedChainSupported = () => {
  const { chainId } = useAccount();
  return useMemo(() => targetNetworksNoHardhat.some((network: Chain) => network.id === chainId), [chainId]);
};

export function useFHE(config?: Partial<FHEConfig>) {
  // TODO: Only initialize if the user is connected to a supported chain
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const isChainSupported = useIsConnectedChainSupported();

  const chainId = publicClient?.chain.id;
  const accountAddress = walletClient?.account.address;

  const [isInitialized, setIsInitialized] = useState(isInitializedGlobally);
  const [isInitializing, setIsInitializing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [permit, setPermit] = useState<Permit | undefined>(undefined);

  // Add checks to ensure we're in a browser environment
  const isBrowser = typeof window !== "undefined";

  // Reset initialization when chain changes
  useEffect(() => {
    isInitializedGlobally = false;
    setIsInitialized(false);
  }, [chainId, accountAddress]);

  // Initialize when wallet is connected
  useEffect(() => {
    // Skip initialization if not in browser
    if (!isBrowser) return;

    const initialize = async () => {
      if (isInitializedGlobally || isInitializing || !publicClient || !walletClient || !isChainSupported) return;
      try {
        setIsInitializing(true);

        const environment = ChainEnvironments[chainId as keyof typeof ChainEnvironments] ?? "TESTNET";

        const defaultConfig = {
          environment,
          verifierUrl: undefined,
          coFheUrl: undefined,
          thresholdNetworkUrl: undefined,
          ignoreErrors: false,
          generatePermit: true,
        };

        // Merge default config with user-provided config
        const mergedConfig = { ...defaultConfig, ...config };

        const result = await fhe.initializeWithViem({
          viemClient: publicClient,
          viemWalletClient: walletClient,
          environment: mergedConfig.environment,
          verifierUrl: mergedConfig.verifierUrl,
          coFheUrl: mergedConfig.coFheUrl,
          thresholdNetworkUrl: mergedConfig.thresholdNetworkUrl,
          ignoreErrors: mergedConfig.ignoreErrors,
          generatePermit: mergedConfig.generatePermit,
        });

        if (result.success) {
          console.log("FHE initialized successfully");
          isInitializedGlobally = true;
          setIsInitialized(true);
          setPermit(result.data);
          setError(null);
        } else {
          setError(new Error(result.error.message || String(result.error)));
        }
      } catch (err) {
        console.error("Failed to initialize FHE:", err);
        setError(err instanceof Error ? err : new Error("Unknown error initializing FHE"));
      } finally {
        setIsInitializing(false);
      }
    };

    initialize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletClient, publicClient, config, chainId, isInitializing, accountAddress, isChainSupported]);

  return {
    isInitialized,
    isInitializing,
    error,
    permit,
    // Expose the original library functions directly
    ...fhe,
    FheTypes,
    Encryptable,
  };
}

export const useFHEjsInitialized = () => {
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    const unsubscribe = fhe.store.subscribe(state =>
      setInitialized(state.providerInitialized && state.signerInitialized && state.fheKeysInitialized),
    );

    // Initial state
    const initialState = fhe.store.getState();
    setInitialized(
      initialState.providerInitialized && initialState.signerInitialized && initialState.fheKeysInitialized,
    );

    return () => {
      unsubscribe();
    };
  }, []);

  return initialized;
};

export const useFHEjsAccount = () => {
  const [account, setAccount] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = fhe.store.subscribe(state => {
      setAccount(state.account);
    });

    // Initial state
    setAccount(fhe.store.getState().account);

    return () => {
      unsubscribe();
    };
  }, []);

  return account;
};

export const useFHEjsActivePermitHashes = () => {
  const [activePermitHash, setActivePermitHash] = useState<ChainRecord<AccountRecord<string | undefined>>>({});

  useEffect(() => {
    const unsubscribe = permitStore.store.subscribe(state => {
      setActivePermitHash(state.activePermitHash);
    });

    setActivePermitHash(permitStore.store.getState().activePermitHash);

    return () => {
      unsubscribe();
    };
  }, []);

  return useMemo(() => activePermitHash, [activePermitHash]);
};

export const useFHEjsActivePermitHash = () => {
  const account = useFHEjsAccount();
  const activePermitHashes = useFHEjsActivePermitHashes();
  const { chainId } = useAccount();

  return useMemo(() => {
    if (!account || !chainId) return undefined;
    return activePermitHashes[chainId]?.[account];
  }, [account, activePermitHashes, chainId]);
};

export const useFHEjsActivePermit = () => {
  const account = useFHEjsAccount();
  const initialized = useFHEjsInitialized();
  const activePermitHash = useFHEjsActivePermitHash();
  const { chainId } = useAccount();

  return useMemo(() => {
    if (!account || !initialized || !chainId) return undefined;
    return permitStore.getPermit(chainId.toString(), account, activePermitHash);
  }, [account, initialized, activePermitHash, chainId]);
};

export const useFHEjsAllPermits = () => {
  const account = useFHEjsAccount();
  const initialized = useFHEjsInitialized();
  const [allPermits, setAllPermits] = useState<Permit[] | undefined>(undefined);

  useEffect(() => {
    if (!account || !initialized) {
      setAllPermits(undefined);
      return;
    }

    const updatePermits = () => {
      // Use fhe.getAllPermits() here as it's the correct API
      const permitsFromStore = fhe.getAllPermits();
      setAllPermits(Object.values(permitsFromStore?.data ?? {}));
    };

    // Initial state
    updatePermits();

    // Subscribe to store changes
    // Assuming permitStore.store.subscribe will be triggered by permitStore.removePermit
    const unsubscribe = permitStore.store.subscribe(updatePermits);

    return () => {
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, initialized]); // Dependencies: re-run when account or initialized status changes.

  return allPermits;
};

// Export FheTypes directly for convenience
export { FheTypes } from "@luxfhe/sdk/web";

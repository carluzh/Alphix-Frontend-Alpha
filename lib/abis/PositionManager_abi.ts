export const position_manager_abi = [
    {
        "type": "constructor",
        "inputs": [
            {
                "name": "_poolManager",
                "type": "address",
                "internalType": "contract IPoolManager"
            },
            {
                "name": "_permit2",
                "type": "address",
                "internalType": "contract IAllowanceTransfer"
            },
            {
                "name": "_unsubscribeGasLimit",
                "type": "uint256",
                "internalType": "uint256"
            },
            {
                "name": "_tokenDescriptor",
                "type": "address",
                "internalType": "contract IPositionDescriptor"
            },
            {
                "name": "_weth9",
                "type": "address",
                "internalType": "contract IWETH9"
            }
        ],
        "stateMutability": "nonpayable"
    },
    {
        "name": "AlreadySubscribed",
        "type": "error",
        "inputs": [
            {
                "name": "tokenId",
                "type": "uint256",
                "internalType": "uint256"
            },
            {
                "name": "subscriber",
                "type": "address",
                "internalType": "address"
            }
        ]
    },
    {
        "name": "BurnNotificationReverted",
        "type": "error",
        "inputs": [
            {
                "name": "subscriber",
                "type": "address",
                "internalType": "address"
            },
            {
                "name": "reason",
                "type": "bytes",
                "internalType": "bytes"
            }
        ]
    },
    {
        "name": "ContractLocked",
        "type": "error",
        "inputs": []
    },
    {
        "name": "DeadlinePassed",
        "type": "error",
        "inputs": [
            {
                "name": "deadline",
                "type": "uint256",
                "internalType": "uint256"
            }
        ]
    },
    {
        "name": "DeltaNotNegative",
        "type": "error",
        "inputs": [
            {
                "name": "currency",
                "type": "address",
                "internalType": "Currency"
            }
        ]
    },
    {
        "name": "DeltaNotPositive",
        "type": "error",
        "inputs": [
            {
                "name": "currency",
                "type": "address",
                "internalType": "Currency"
            }
        ]
    },
    {
        "name": "GasLimitTooLow",
        "type": "error",
        "inputs": []
    },
    {
        "name": "InputLengthMismatch",
        "type": "error",
        "inputs": []
    },
    {
        "name": "InsufficientBalance",
        "type": "error",
        "inputs": []
    },
    {
        "name": "InvalidContractSignature",
        "type": "error",
        "inputs": []
    },
    {
        "name": "InvalidEthSender",
        "type": "error",
        "inputs": []
    },
    {
        "name": "InvalidSignature",
        "type": "error",
        "inputs": []
    },
    {
        "name": "InvalidSignatureLength",
        "type": "error",
        "inputs": []
    },
    {
        "name": "InvalidSigner",
        "type": "error",
        "inputs": []
    },
    {
        "name": "MaximumAmountExceeded",
        "type": "error",
        "inputs": [
            {
                "name": "maximumAmount",
                "type": "uint128",
                "internalType": "uint128"
            },
            {
                "name": "amountRequested",
                "type": "uint128",
                "internalType": "uint128"
            }
        ]
    },
    {
        "name": "MinimumAmountInsufficient",
        "type": "error",
        "inputs": [
            {
                "name": "minimumAmount",
                "type": "uint128",
                "internalType": "uint128"
            },
            {
                "name": "amountReceived",
                "type": "uint128",
                "internalType": "uint128"
            }
        ]
    },
    {
        "name": "ModifyLiquidityNotificationReverted",
        "type": "error",
        "inputs": [
            {
                "name": "subscriber",
                "type": "address",
                "internalType": "address"
            },
            {
                "name": "reason",
                "type": "bytes",
                "internalType": "bytes"
            }
        ]
    },
    {
        "name": "NoCodeSubscriber",
        "type": "error",
        "inputs": []
    },
    {
        "name": "NoSelfPermit",
        "type": "error",
        "inputs": []
    },
    {
        "name": "NonceAlreadyUsed",
        "type": "error",
        "inputs": []
    },
    {
        "name": "NotApproved",
        "type": "error",
        "inputs": [
            {
                "name": "caller",
                "type": "address",
                "internalType": "address"
            }
        ]
    },
    {
        "name": "NotPoolManager",
        "type": "error",
        "inputs": []
    },
    {
        "name": "NotSubscribed",
        "type": "error",
        "inputs": []
    },
    {
        "name": "PoolManagerMustBeLocked",
        "type": "error",
        "inputs": []
    },
    {
        "name": "SignatureDeadlineExpired",
        "type": "error",
        "inputs": []
    },
    {
        "name": "SubscriptionReverted",
        "type": "error",
        "inputs": [
            {
                "name": "subscriber",
                "type": "address",
                "internalType": "address"
            },
            {
                "name": "reason",
                "type": "bytes",
                "internalType": "bytes"
            }
        ]
    },
    {
        "name": "Unauthorized",
        "type": "error",
        "inputs": []
    },
    {
        "name": "UnsupportedAction",
        "type": "error",
        "inputs": [
            {
                "name": "action",
                "type": "uint256",
                "internalType": "uint256"
            }
        ]
    },
    {
        "name": "Approval",
        "type": "event",
        "inputs": [
            {
                "name": "owner",
                "type": "address",
                "indexed": true,
                "internalType": "address"
            },
            {
                "name": "spender",
                "type": "address",
                "indexed": true,
                "internalType": "address"
            },
            {
                "name": "id",
                "type": "uint256",
                "indexed": true,
                "internalType": "uint256"
            }
        ],
        "anonymous": false
    },
    {
        "name": "ApprovalForAll",
        "type": "event",
        "inputs": [
            {
                "name": "owner",
                "type": "address",
                "indexed": true,
                "internalType": "address"
            },
            {
                "name": "operator",
                "type": "address",
                "indexed": true,
                "internalType": "address"
            },
            {
                "name": "approved",
                "type": "bool",
                "indexed": false,
                "internalType": "bool"
            }
        ],
        "anonymous": false
    },
    {
        "name": "Subscription",
        "type": "event",
        "inputs": [
            {
                "name": "tokenId",
                "type": "uint256",
                "indexed": true,
                "internalType": "uint256"
            },
            {
                "name": "subscriber",
                "type": "address",
                "indexed": true,
                "internalType": "address"
            }
        ],
        "anonymous": false
    },
    {
        "name": "Transfer",
        "type": "event",
        "inputs": [
            {
                "name": "from",
                "type": "address",
                "indexed": true,
                "internalType": "address"
            },
            {
                "name": "to",
                "type": "address",
                "indexed": true,
                "internalType": "address"
            },
            {
                "name": "id",
                "type": "uint256",
                "indexed": true,
                "internalType": "uint256"
            }
        ],
        "anonymous": false
    },
    {
        "name": "Unsubscription",
        "type": "event",
        "inputs": [
            {
                "name": "tokenId",
                "type": "uint256",
                "indexed": true,
                "internalType": "uint256"
            },
            {
                "name": "subscriber",
                "type": "address",
                "indexed": true,
                "internalType": "address"
            }
        ],
        "anonymous": false
    },
    {
        "name": "DOMAIN_SEPARATOR",
        "type": "function",
        "inputs": [],
        "outputs": [
            {
                "name": "",
                "type": "bytes32",
                "internalType": "bytes32"
            }
        ],
        "stateMutability": "view"
    },
    {
        "name": "WETH9",
        "type": "function",
        "inputs": [],
        "outputs": [
            {
                "name": "",
                "type": "address",
                "internalType": "contract IWETH9"
            }
        ],
        "stateMutability": "view"
    },
    {
        "name": "approve",
        "type": "function",
        "inputs": [
            {
                "name": "spender",
                "type": "address",
                "internalType": "address"
            },
            {
                "name": "id",
                "type": "uint256",
                "internalType": "uint256"
            }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
    },
    {
        "name": "balanceOf",
        "type": "function",
        "inputs": [
            {
                "name": "owner",
                "type": "address",
                "internalType": "address"
            }
        ],
        "outputs": [
            {
                "name": "",
                "type": "uint256",
                "internalType": "uint256"
            }
        ],
        "stateMutability": "view"
    },
    {
        "name": "getApproved",
        "type": "function",
        "inputs": [
            {
                "name": "",
                "type": "uint256",
                "internalType": "uint256"
            }
        ],
        "outputs": [
            {
                "name": "",
                "type": "address",
                "internalType": "address"
            }
        ],
        "stateMutability": "view"
    },
    {
        "name": "getPoolAndPositionInfo",
        "type": "function",
        "inputs": [
            {
                "name": "tokenId",
                "type": "uint256",
                "internalType": "uint256"
            }
        ],
        "outputs": [
            {
                "name": "poolKey",
                "type": "tuple",
                "components": [
                    {
                        "name": "currency0",
                        "type": "address",
                        "internalType": "Currency"
                    },
                    {
                        "name": "currency1",
                        "type": "address",
                        "internalType": "Currency"
                    },
                    {
                        "name": "fee",
                        "type": "uint24",
                        "internalType": "uint24"
                    },
                    {
                        "name": "tickSpacing",
                        "type": "int24",
                        "internalType": "int24"
                    },
                    {
                        "name": "hooks",
                        "type": "address",
                        "internalType": "contract IHooks"
                    }
                ],
                "internalType": "struct PoolKey"
            },
            {
                "name": "info",
                "type": "uint256",
                "internalType": "PositionInfo"
            }
        ],
        "stateMutability": "view"
    },
    {
        "name": "getPositionLiquidity",
        "type": "function",
        "inputs": [
            {
                "name": "tokenId",
                "type": "uint256",
                "internalType": "uint256"
            }
        ],
        "outputs": [
            {
                "name": "liquidity",
                "type": "uint128",
                "internalType": "uint128"
            }
        ],
        "stateMutability": "view"
    },
    {
        "name": "initializePool",
        "type": "function",
        "inputs": [
            {
                "name": "key",
                "type": "tuple",
                "components": [
                    {
                        "name": "currency0",
                        "type": "address",
                        "internalType": "Currency"
                    },
                    {
                        "name": "currency1",
                        "type": "address",
                        "internalType": "Currency"
                    },
                    {
                        "name": "fee",
                        "type": "uint24",
                        "internalType": "uint24"
                    },
                    {
                        "name": "tickSpacing",
                        "type": "int24",
                        "internalType": "int24"
                    },
                    {
                        "name": "hooks",
                        "type": "address",
                        "internalType": "contract IHooks"
                    }
                ],
                "internalType": "struct PoolKey"
            },
            {
                "name": "sqrtPriceX96",
                "type": "uint160",
                "internalType": "uint160"
            }
        ],
        "outputs": [
            {
                "name": "",
                "type": "int24",
                "internalType": "int24"
            }
        ],
        "stateMutability": "payable"
    },
    {
        "name": "isApprovedForAll",
        "type": "function",
        "inputs": [
            {
                "name": "",
                "type": "address",
                "internalType": "address"
            },
            {
                "name": "",
                "type": "address",
                "internalType": "address"
            }
        ],
        "outputs": [
            {
                "name": "",
                "type": "bool",
                "internalType": "bool"
            }
        ],
        "stateMutability": "view"
    },
    {
        "name": "modifyLiquidities",
        "type": "function",
        "inputs": [
            {
                "name": "unlockData",
                "type": "bytes",
                "internalType": "bytes"
            },
            {
                "name": "deadline",
                "type": "uint256",
                "internalType": "uint256"
            }
        ],
        "outputs": [],
        "stateMutability": "payable"
    },
    {
        "name": "modifyLiquiditiesWithoutUnlock",
        "type": "function",
        "inputs": [
            {
                "name": "actions",
                "type": "bytes",
                "internalType": "bytes"
            },
            {
                "name": "params",
                "type": "bytes[]",
                "internalType": "bytes[]"
            }
        ],
        "outputs": [],
        "stateMutability": "payable"
    },
    {
        "name": "msgSender",
        "type": "function",
        "inputs": [],
        "outputs": [
            {
                "name": "",
                "type": "address",
                "internalType": "address"
            }
        ],
        "stateMutability": "view"
    },
    {
        "name": "multicall",
        "type": "function",
        "inputs": [
            {
                "name": "data",
                "type": "bytes[]",
                "internalType": "bytes[]"
            }
        ],
        "outputs": [
            {
                "name": "results",
                "type": "bytes[]",
                "internalType": "bytes[]"
            }
        ],
        "stateMutability": "payable"
    },
    {
        "name": "name",
        "type": "function",
        "inputs": [],
        "outputs": [
            {
                "name": "",
                "type": "string",
                "internalType": "string"
            }
        ],
        "stateMutability": "view"
    },
    {
        "name": "nextTokenId",
        "type": "function",
        "inputs": [],
        "outputs": [
            {
                "name": "",
                "type": "uint256",
                "internalType": "uint256"
            }
        ],
        "stateMutability": "view"
    },
    {
        "name": "nonces",
        "type": "function",
        "inputs": [
            {
                "name": "owner",
                "type": "address",
                "internalType": "address"
            },
            {
                "name": "word",
                "type": "uint256",
                "internalType": "uint256"
            }
        ],
        "outputs": [
            {
                "name": "bitmap",
                "type": "uint256",
                "internalType": "uint256"
            }
        ],
        "stateMutability": "view"
    },
    {
        "name": "ownerOf",
        "type": "function",
        "inputs": [
            {
                "name": "id",
                "type": "uint256",
                "internalType": "uint256"
            }
        ],
        "outputs": [
            {
                "name": "owner",
                "type": "address",
                "internalType": "address"
            }
        ],
        "stateMutability": "view"
    },
    {
        "name": "permit",
        "type": "function",
        "inputs": [
            {
                "name": "spender",
                "type": "address",
                "internalType": "address"
            },
            {
                "name": "tokenId",
                "type": "uint256",
                "internalType": "uint256"
            },
            {
                "name": "deadline",
                "type": "uint256",
                "internalType": "uint256"
            },
            {
                "name": "nonce",
                "type": "uint256",
                "internalType": "uint256"
            },
            {
                "name": "signature",
                "type": "bytes",
                "internalType": "bytes"
            }
        ],
        "outputs": [],
        "stateMutability": "payable"
    },
    {
        "name": "permit",
        "type": "function",
        "inputs": [
            {
                "name": "owner",
                "type": "address",
                "internalType": "address"
            },
            {
                "name": "permitSingle",
                "type": "tuple",
                "components": [
                    {
                        "name": "details",
                        "type": "tuple",
                        "components": [
                            {
                                "name": "token",
                                "type": "address",
                                "internalType": "address"
                            },
                            {
                                "name": "amount",
                                "type": "uint160",
                                "internalType": "uint160"
                            },
                            {
                                "name": "expiration",
                                "type": "uint48",
                                "internalType": "uint48"
                            },
                            {
                                "name": "nonce",
                                "type": "uint48",
                                "internalType": "uint48"
                            }
                        ],
                        "internalType": "struct IAllowanceTransfer.PermitDetails"
                    },
                    {
                        "name": "spender",
                        "type": "address",
                        "internalType": "address"
                    },
                    {
                        "name": "sigDeadline",
                        "type": "uint256",
                        "internalType": "uint256"
                    }
                ],
                "internalType": "struct IAllowanceTransfer.PermitSingle"
            },
            {
                "name": "signature",
                "type": "bytes",
                "internalType": "bytes"
            }
        ],
        "outputs": [
            {
                "name": "err",
                "type": "bytes",
                "internalType": "bytes"
            }
        ],
        "stateMutability": "payable"
    },
    {
        "name": "permit2",
        "type": "function",
        "inputs": [],
        "outputs": [
            {
                "name": "",
                "type": "address",
                "internalType": "contract IAllowanceTransfer"
            }
        ],
        "stateMutability": "view"
    },
    {
        "name": "permitBatch",
        "type": "function",
        "inputs": [
            {
                "name": "owner",
                "type": "address",
                "internalType": "address"
            },
            {
                "name": "_permitBatch",
                "type": "tuple",
                "components": [
                    {
                        "name": "details",
                        "type": "tuple[]",
                        "components": [
                            {
                                "name": "token",
                                "type": "address",
                                "internalType": "address"
                            },
                            {
                                "name": "amount",
                                "type": "uint160",
                                "internalType": "uint160"
                            },
                            {
                                "name": "expiration",
                                "type": "uint48",
                                "internalType": "uint48"
                            },
                            {
                                "name": "nonce",
                                "type": "uint48",
                                "internalType": "uint48"
                            }
                        ],
                        "internalType": "struct IAllowanceTransfer.PermitDetails[]"
                    },
                    {
                        "name": "spender",
                        "type": "address",
                        "internalType": "address"
                    },
                    {
                        "name": "sigDeadline",
                        "type": "uint256",
                        "internalType": "uint256"
                    }
                ],
                "internalType": "struct IAllowanceTransfer.PermitBatch"
            },
            {
                "name": "signature",
                "type": "bytes",
                "internalType": "bytes"
            }
        ],
        "outputs": [
            {
                "name": "err",
                "type": "bytes",
                "internalType": "bytes"
            }
        ],
        "stateMutability": "payable"
    },
    {
        "name": "permitForAll",
        "type": "function",
        "inputs": [
            {
                "name": "owner",
                "type": "address",
                "internalType": "address"
            },
            {
                "name": "operator",
                "type": "address",
                "internalType": "address"
            },
            {
                "name": "approved",
                "type": "bool",
                "internalType": "bool"
            },
            {
                "name": "deadline",
                "type": "uint256",
                "internalType": "uint256"
            },
            {
                "name": "nonce",
                "type": "uint256",
                "internalType": "uint256"
            },
            {
                "name": "signature",
                "type": "bytes",
                "internalType": "bytes"
            }
        ],
        "outputs": [],
        "stateMutability": "payable"
    },
    {
        "name": "poolKeys",
        "type": "function",
        "inputs": [
            {
                "name": "poolId",
                "type": "bytes25",
                "internalType": "bytes25"
            }
        ],
        "outputs": [
            {
                "name": "currency0",
                "type": "address",
                "internalType": "Currency"
            },
            {
                "name": "currency1",
                "type": "address",
                "internalType": "Currency"
            },
            {
                "name": "fee",
                "type": "uint24",
                "internalType": "uint24"
            },
            {
                "name": "tickSpacing",
                "type": "int24",
                "internalType": "int24"
            },
            {
                "name": "hooks",
                "type": "address",
                "internalType": "contract IHooks"
            }
        ],
        "stateMutability": "view"
    },
    {
        "name": "poolManager",
        "type": "function",
        "inputs": [],
        "outputs": [
            {
                "name": "",
                "type": "address",
                "internalType": "contract IPoolManager"
            }
        ],
        "stateMutability": "view"
    },
    {
        "name": "positionInfo",
        "type": "function",
        "inputs": [
            {
                "name": "tokenId",
                "type": "uint256",
                "internalType": "uint256"
            }
        ],
        "outputs": [
            {
                "name": "info",
                "type": "uint256",
                "internalType": "PositionInfo"
            }
        ],
        "stateMutability": "view"
    },
    {
        "name": "revokeNonce",
        "type": "function",
        "inputs": [
            {
                "name": "nonce",
                "type": "uint256",
                "internalType": "uint256"
            }
        ],
        "outputs": [],
        "stateMutability": "payable"
    },
    {
        "name": "safeTransferFrom",
        "type": "function",
        "inputs": [
            {
                "name": "from",
                "type": "address",
                "internalType": "address"
            },
            {
                "name": "to",
                "type": "address",
                "internalType": "address"
            },
            {
                "name": "id",
                "type": "uint256",
                "internalType": "uint256"
            }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
    },
    {
        "name": "safeTransferFrom",
        "type": "function",
        "inputs": [
            {
                "name": "from",
                "type": "address",
                "internalType": "address"
            },
            {
                "name": "to",
                "type": "address",
                "internalType": "address"
            },
            {
                "name": "id",
                "type": "uint256",
                "internalType": "uint256"
            },
            {
                "name": "data",
                "type": "bytes",
                "internalType": "bytes"
            }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
    },
    {
        "name": "setApprovalForAll",
        "type": "function",
        "inputs": [
            {
                "name": "operator",
                "type": "address",
                "internalType": "address"
            },
            {
                "name": "approved",
                "type": "bool",
                "internalType": "bool"
            }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
    },
    {
        "name": "subscribe",
        "type": "function",
        "inputs": [
            {
                "name": "tokenId",
                "type": "uint256",
                "internalType": "uint256"
            },
            {
                "name": "newSubscriber",
                "type": "address",
                "internalType": "address"
            },
            {
                "name": "data",
                "type": "bytes",
                "internalType": "bytes"
            }
        ],
        "outputs": [],
        "stateMutability": "payable"
    },
    {
        "name": "subscriber",
        "type": "function",
        "inputs": [
            {
                "name": "tokenId",
                "type": "uint256",
                "internalType": "uint256"
            }
        ],
        "outputs": [
            {
                "name": "subscriber",
                "type": "address",
                "internalType": "contract ISubscriber"
            }
        ],
        "stateMutability": "view"
    },
    {
        "name": "supportsInterface",
        "type": "function",
        "inputs": [
            {
                "name": "interfaceId",
                "type": "bytes4",
                "internalType": "bytes4"
            }
        ],
        "outputs": [
            {
                "name": "",
                "type": "bool",
                "internalType": "bool"
            }
        ],
        "stateMutability": "view"
    },
    {
        "name": "symbol",
        "type": "function",
        "inputs": [],
        "outputs": [
            {
                "name": "",
                "type": "string",
                "internalType": "string"
            }
        ],
        "stateMutability": "view"
    },
    {
        "name": "tokenDescriptor",
        "type": "function",
        "inputs": [],
        "outputs": [
            {
                "name": "",
                "type": "address",
                "internalType": "contract IPositionDescriptor"
            }
        ],
        "stateMutability": "view"
    },
    {
        "name": "tokenURI",
        "type": "function",
        "inputs": [
            {
                "name": "tokenId",
                "type": "uint256",
                "internalType": "uint256"
            }
        ],
        "outputs": [
            {
                "name": "",
                "type": "string",
                "internalType": "string"
            }
        ],
        "stateMutability": "view"
    },
    {
        "name": "transferFrom",
        "type": "function",
        "inputs": [
            {
                "name": "from",
                "type": "address",
                "internalType": "address"
            },
            {
                "name": "to",
                "type": "address",
                "internalType": "address"
            },
            {
                "name": "id",
                "type": "uint256",
                "internalType": "uint256"
            }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
    },
    {
        "name": "unlockCallback",
        "type": "function",
        "inputs": [
            {
                "name": "data",
                "type": "bytes",
                "internalType": "bytes"
            }
        ],
        "outputs": [
            {
                "name": "",
                "type": "bytes",
                "internalType": "bytes"
            }
        ],
        "stateMutability": "nonpayable"
    },
    {
        "name": "unsubscribe",
        "type": "function",
        "inputs": [
            {
                "name": "tokenId",
                "type": "uint256",
                "internalType": "uint256"
            }
        ],
        "outputs": [],
        "stateMutability": "payable"
    },
    {
        "name": "unsubscribeGasLimit",
        "type": "function",
        "inputs": [],
        "outputs": [
            {
                "name": "",
                "type": "uint256",
                "internalType": "uint256"
            }
        ],
        "stateMutability": "view"
    },
    {
        "type": "receive",
        "stateMutability": "payable"
    }
]
import { describe, expect, it } from "vitest";

import {
  buildGuardianSnapshotFromOnchainosDeFiDetails,
  parseOnchainosDefiPositionDetail,
  parseOnchainosDefiPositionsOverview,
} from "../src/adapters/portfolio.ts";

describe("onchainos defi portfolio normalization", () => {
  it("parses positions overview into platform summaries", () => {
    const stdout = JSON.stringify({
      ok: true,
      data: {
        walletIdPlatformList: [
          {
            platformList: [
              {
                platformName: "Morpho",
                analysisPlatformId: 119170,
                currencyAmount: "120.5",
              },
              {
                platformName: "Uniswap V3",
                analysisPlatformId: 204,
                currencyAmount: "80",
              },
            ],
          },
        ],
        assetStatus: 1,
      },
    });

    expect(parseOnchainosDefiPositionsOverview(stdout)).toEqual([
      {
        analysisPlatformId: "119170",
        platformName: "Morpho",
        currencyAmount: "120.5",
      },
      {
        analysisPlatformId: "204",
        platformName: "Uniswap V3",
        currencyAmount: "80",
      },
    ]);
  });

  it("uses official investType values from position-detail to classify lending vs lp buckets", () => {
    const morphoDetail = JSON.stringify({
      ok: true,
      data: {
        platformName: "Morpho",
        analysisPlatformId: 119170,
        walletIdPlatformDetailList: [
          {
            networkHoldVoList: [
              {
                investTokenBalanceVoList: [
                  {
                    investType: 4,
                    totalValue: "120",
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    const uniswapDetail = JSON.stringify({
      ok: true,
      data: {
        platformName: "Uniswap V3",
        analysisPlatformId: 204,
        walletIdPlatformDetailList: [
          {
            networkHoldVoList: [
              {
                investTokenBalanceVoList: [
                  {
                    investType: 2,
                    totalValue: "80",
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    const details = [
      ...parseOnchainosDefiPositionDetail(morphoDetail),
      ...parseOnchainosDefiPositionDetail(uniswapDetail),
    ];
    const result = buildGuardianSnapshotFromOnchainosDeFiDetails(details, 123);

    expect(result).toEqual({
      status: "classified",
      snapshot: {
        asOf: 123,
        buckets: [
          { kind: "lending", currentBps: 6000, targetBps: 5000 },
          { kind: "lp", currentBps: 4000, targetBps: 5000 },
        ],
      },
    });
  });

  it("parses array-wrapped position-detail payloads returned by onchainos", () => {
    const detail = JSON.stringify({
      ok: true,
      data: [
        {
          platformName: "Morpho",
          analysisPlatformId: 119170,
          walletIdPlatformDetailList: [
            {
              networkHoldVoList: [
                {
                  investTokenBalanceVoList: [
                    {
                      investType: 4,
                      totalValue: "120",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(parseOnchainosDefiPositionDetail(detail)).toEqual([
      {
        analysisPlatformId: "119170",
        platformName: "Morpho",
        investType: "4",
        totalValue: "120",
      },
    ]);
  });

  it("returns insufficient_data when official detail payload lacks classified investType values", () => {
    const unknownDetail = JSON.stringify({
      ok: true,
      data: {
        platformName: "Unknown",
        analysisPlatformId: 999,
        walletIdPlatformDetailList: [
          {
            networkHoldVoList: [
              {
                investTokenBalanceVoList: [
                  {
                    investType: 9,
                    totalValue: "50",
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    const details = parseOnchainosDefiPositionDetail(unknownDetail);
    expect(buildGuardianSnapshotFromOnchainosDeFiDetails(details, 123)).toEqual({
      status: "insufficient_data",
      reason: "official_positions_missing_classified_bucket_values",
    });
  });
});

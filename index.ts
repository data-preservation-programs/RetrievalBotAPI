import {APIGatewayProxyEventV2, APIGatewayProxyResult, Context} from "aws-lambda";
import {MongoClient} from "mongodb";

const mongo = new MongoClient(process.env.MONGO_URI!)

interface resultRow {
  _id: {
    module: string,
    success: boolean
  },
  count: number,
  ttfb_p50: [number | null],
  ttfb_p95: [number | null],
}

export async function handler(event: APIGatewayProxyEventV2, _: Context): Promise<APIGatewayProxyResult> {
  const token = event.queryStringParameters?.["token"]
  const client = event.queryStringParameters?.["client"]
  const provider = event.queryStringParameters?.["provider"]
  const date = event.queryStringParameters?.["date"]
  if (token !== process.env.TOKEN) {
    return {
      statusCode: 401,
      body: "Unauthorized"
    }
  }
  if (client == undefined && provider == undefined) {
    return {
      statusCode: 400,
      body: "client or provider is required"
    }
  }
  if (client != undefined && provider != undefined) {
    return {
      statusCode: 400,
      body: "provide either client or provider, not both"
    }
  }
  if (date == undefined) {
    return {
      statusCode: 400,
      body: "date is required"
    }
  }

  const match: any = {
    'task.requester': 'filplus',
    'created_at': {
      $gte: new Date(date),
      $lt: new Date(date + "T23:59:59.999Z")
    }
  }

  if (client != undefined) {
    match['task.metadata.client'] = client
  }
  if (provider != undefined) {
    match['task.provider.id'] = provider
  }

  const result: resultRow[] = await (mongo.db("prod").collection("task_result").aggregate([
    {
      $match: match
    }, {
      $group: {
        _id: {
          module: "$task.module",
          success: "$result.success"
        },
        count: {$sum: 1},
        ttfb_p50: {
          $percentile: {
            input: "$result.ttfb",
            p: [0.5],
            method: 'approximate'
          }
        },
        ttfb_p95: {
          $percentile: {
            input: "$result.ttfb",
            p: [0.95],
            method: 'approximate'
          }
        },
      },
    }
  ])).toArray() as resultRow[]

  const resultByModule = new Map<string, { total: number, success: number, ttfb_p50: number | null, ttfb_p95: number | null }>()
  for (const row of result) {
    const module = row._id.module
    const success = row._id.success
    const count = row.count
    const ttfb_p50 = row.ttfb_p50[0]
    const ttfb_p95 = row.ttfb_p95[0]
    if (!resultByModule.has(module)) {
      resultByModule.set(module, {total: 0, success: 0, ttfb_p50: null, ttfb_p95: null})
    }
    const moduleResult = resultByModule.get(module)!
    moduleResult.total += count
    if (success) {
      moduleResult.success += count
      moduleResult.ttfb_p50 = ttfb_p50
      moduleResult.ttfb_p95 = ttfb_p95
    }
  }

  const resultByModuleArray = Array.from(resultByModule.entries()).map(([module, {total, success, ttfb_p50, ttfb_p95}]) => {
    return {
      module,
      total,
      success,
      ttfb_p50,
      ttfb_p95
    }
  })
  return {
    statusCode: 200,
    body: JSON.stringify(resultByModuleArray)
  }
}

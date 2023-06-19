import {APIGatewayProxyEventV2, APIGatewayProxyResult, Context} from "aws-lambda";
import {MongoClient} from "mongodb";

const mongo = new MongoClient(process.env.MONGO_URI!)

interface resultRow {
  _id: {
    module: string,
    success: boolean
  },
  count: number
}

export async function handler(event: APIGatewayProxyEventV2, _: Context): Promise<APIGatewayProxyResult> {
  const token = event.queryStringParameters?.["token"]
  const client = event.queryStringParameters?.["client"]
  const date = event.queryStringParameters?.["date"]
  if (token !== process.env.TOKEN) {
    return {
      statusCode: 401,
      body: "Unauthorized"
    }
  }
  if (client == undefined) {
    return {
      statusCode: 400,
      body: "client is required"
    }
  }
  if (date == undefined) {
    return {
      statusCode: 400,
      body: "date is required"
    }
  }


  const result: resultRow[] = await (mongo.db("prod").collection("task_result").aggregate([
    {
      $match: {
        'task.requester': 'filplus',
        'task.metadata.client': client,
        'created_at': {
          $gte: new Date(date),
          $lt: new Date(date + "T23:59:59.999Z")
        }
      }
    }, {
      $group: {
        _id: {
          module: "$task.module",
          success: "$result.success"
        },
        count: {$sum: 1},
      },
    }
  ])).toArray() as resultRow[]

  const resultByModule = new Map<string, { total: number, success: number }>()
  for (const row of result) {
    const module = row._id.module
    const success = row._id.success
    const count = row.count
    if (!resultByModule.has(module)) {
      resultByModule.set(module, {total: 0, success: 0})
    }
    const moduleResult = resultByModule.get(module)!
    moduleResult.total += count
    if (success) {
      moduleResult.success += count
    }
  }

  const resultByModuleArray = Array.from(resultByModule.entries()).map(([module, {total, success}]) => {
    return {
      module,
      total,
      success,
    }
  })
  return {
    statusCode: 200,
    body: JSON.stringify(resultByModuleArray)
  }
}

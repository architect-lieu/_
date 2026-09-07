# AI回音录 CloudBase 测试环境接入

当前代码默认关闭云端连接。只有完成下面配置并由用户主动点击“上传到私有云存储”，录音才会上传。

1. 使用正式小程序 AppID 打开 `app` 项目。
2. 在微信开发者工具中开通一个“开发环境”的云开发环境。
3. 复制环境 ID，填入 `config/cloud.js` 的 `envId`。
4. 在云开发数据库中创建集合 `recordings`、`users`、`orders`、`works`，客户端权限均设为不可直接读写，统一由云函数按 OpenID 鉴权；生产使用前需再次复核安全规则。
5. 在开发者工具的 `cloudfunctions/recordRecording` 上选择“上传并部署：云端安装依赖”。
6. 重新编译，完成录音和本机保存后，点击“上传到私有云存储”。

云端记录包含微信 OpenID、录音 fileID、问题、时长、文件大小及处理状态。

## 用户与微信支付

1. 部署 `userCenter`、`orderCenter`、`payCallback` 三个云函数，选择“云端安装依赖”。
2. `users`、`orders` 集合禁止客户端直接读写；用户身份以云函数上下文中的 OpenID 为准。
3. 在 `orderCenter` 的云函数环境变量中填写：
   - `WXPAY_SUB_MCH_ID`：已与当前小程序 AppID 绑定的微信支付商户号。
   - `WXPAY_ENV_ID`：当前云开发环境 ID。
   - `WXPAY_CALLBACK_FUNCTION`：默认 `payCallback`。
4. 为 `orderCenter` 开通 `cloudPay.unifiedOrder` 云调用权限，并按控制台指引绑定商户号。
5. 支付回调只根据服务端返回的订单号和金额更新订单，不能相信客户端传入的价格或支付状态。
6. 未完成上述支付配置时，系统仍可完成登录和创建待支付订单，但不会调起真实付款。

## AI 故事整理

1. 在 CloudBase 控制台进入当前环境的 `AI+`，开通模型能力并确认一个可用的文本模型。
2. 部署 `generateStory` 云函数，选择“云端安装依赖”，并将超时时间设置为至少 60 秒。
3. 默认模型 ID 为 `hy3`；如果控制台提供的模型 ID 不同，在云函数环境变量中设置 `STORY_MODEL_ID`。
4. `CLOUDBASE_ENV_ID` 可设置为当前环境 ID；未设置时当前项目默认使用 `cloud1-6gsz1a2qfbb4e404`。
5. `works` 集合禁止客户端直接读写。模型原文、Token 用量、草稿和确认状态全部由云函数记录。

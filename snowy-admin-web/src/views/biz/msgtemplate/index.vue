<template>
	<a-card :bordered="false">
		<a-form ref="searchFormRef" :model="searchFormState">
			<a-row :gutter="10">
				<a-col :xs="24" :sm="6" :md="6" :lg="6" :xl="6">
					<a-form-item name="channel" label="渠道">
						<a-select v-model:value="searchFormState.channel" placeholder="全部渠道" allow-clear>
							<a-select-option value="email">邮件 (email)</a-select-option>
							<a-select-option value="sms">短信 (sms)</a-select-option>
							<a-select-option value="inbox">站内信 (inbox)</a-select-option>
							<a-select-option value="wechat">微信 (wechat)</a-select-option>
						</a-select>
					</a-form-item>
				</a-col>
				<a-col :xs="24" :sm="5" :md="5" :lg="5" :xl="5">
					<a-form-item name="status" label="状态">
						<a-select v-model:value="searchFormState.status" placeholder="全部" allow-clear>
							<a-select-option value="active">启用</a-select-option>
							<a-select-option value="inactive">停用</a-select-option>
						</a-select>
					</a-form-item>
				</a-col>
				<a-col :xs="24" :sm="7" :md="7" :lg="7" :xl="7">
					<a-form-item name="searchKey" label="关键词">
						<a-input v-model:value="searchFormState.searchKey" placeholder="编码/标题/内容" allow-clear />
					</a-form-item>
				</a-col>
				<a-col :xs="24" :sm="6" :md="6" :lg="6" :xl="6">
					<a-form-item>
						<a-space>
							<a-button type="primary" @click="tableRef.refresh(true)">
								<template #icon><SearchOutlined /></template>
								查询
							</a-button>
							<a-button @click="reset">
								<template #icon><redo-outlined /></template>
								重置
							</a-button>
						</a-space>
					</a-form-item>
				</a-col>
			</a-row>
		</a-form>
		<s-table
			ref="tableRef"
			:columns="columns"
			:data="loadData"
			:alert="false"
			bordered
			:tool-config="{ refresh: true, height: true, columnSetting: true }"
			:row-key="(record) => record.id"
			:row-selection="options.rowSelection"
			:scroll="{ x: 'max-content' }"
		>
			<template #operator>
				<a-space>
					<a-button type="primary" @click="formRef.onOpen()" v-if="hasPerm('bizMsgTemplateAdd')">
						<template #icon><plus-outlined /></template>
						新增模板
					</a-button>
					<xn-batch-button
						v-if="hasPerm('bizMsgTemplateBatchDelete')"
						buttonName="批量删除"
						icon="DeleteOutlined"
						buttonDanger
						:selectedRowKeys="selectedRowKeys"
						@batchCallBack="deleteBatch"
					/>
				</a-space>
			</template>
			<template #bodyCell="{ column, record }">
				<template v-if="column.dataIndex === 'channel'">
					<a-tag color="blue">{{ record.channel }}</a-tag>
				</template>
				<template v-if="column.dataIndex === 'status'">
					<a-tag :color="record.status === 'active' ? 'green' : 'default'">
						{{ record.status === 'active' ? '启用' : '停用' }}
					</a-tag>
				</template>
				<template v-if="column.dataIndex === 'action'">
					<a-space size="small">
						<a @click="openDebugModal(record)" v-if="hasPerm('bizMsgTemplateTestSend')">调试预览</a>
						<a @click="formRef.onOpen(record)" v-if="hasPerm('bizMsgTemplateEdit')">编辑</a>
						<a-popconfirm title="确定删除此模板？" @confirm="removeOne(record)">
							<a-button type="link" danger size="small" v-if="hasPerm('bizMsgTemplateDelete')">删除</a-button>
						</a-popconfirm>
					</a-space>
				</template>
			</template>
		</s-table>
	</a-card>
	<Form ref="formRef" @successful="tableRef.refresh(true)" />
	<a-modal v-model:open="debugVisible" title="模板渲染调试与测试发送" :width="600" :footer="null" :destroy-on-close="true">
		<a-form layout="vertical">
			<a-form-item label="变量 JSON">
				<a-textarea v-model:value="debugForm.paramsJson" :rows="3" />
			</a-form-item>
			<a-form-item label="接收邮箱或手机号（仅勾选实际发送时必填）">
				<a-input v-model:value="debugForm.target" placeholder="例如：admin@example.edu.cn" allow-clear />
			</a-form-item>
			<a-space>
				<a-button type="primary" :loading="debugLoading" @click="runTestSend(true)">仅渲染预览</a-button>
				<a-button :loading="debugLoading" @click="runTestSend(false)">实际调试发送</a-button>
			</a-space>
		</a-form>
		<a-divider v-if="debugResult" />
		<div v-if="debugResult">
			<p><strong>渲染标题：</strong>{{ debugResult.renderedTitle || '（无标题）' }}</p>
			<p><strong>渲染正文：</strong></p>
			<a-card size="small"><pre style="white-space: pre-wrap; margin: 0">{{ debugResult.renderedContent }}</pre></a-card>
		</div>
	</a-modal>
</template>

<script setup name="bizMsgTemplate">
	import { message } from 'ant-design-vue'
	import bizMsgTemplateApi from '@/api/biz/bizMsgTemplateApi'
	import Form from './form.vue'

	const columns = [
		{ title: '通知渠道', dataIndex: 'channel' },
		{ title: '模板编码', dataIndex: 'templateCode' },
		{ title: '模板标题', dataIndex: 'title' },
		{ title: '模板内容', dataIndex: 'content', ellipsis: true },
		{ title: '状态', dataIndex: 'status' },
		{ title: '更新时间', dataIndex: 'updateTime' }
	]
	if (hasPerm(['bizMsgTemplateTestSend', 'bizMsgTemplateEdit', 'bizMsgTemplateDelete'])) {
		columns.push({ title: '操作', dataIndex: 'action', align: 'center', fixed: 'right', width: 200 })
	}

	const tableRef = ref(null)
	const formRef = ref()
	const searchFormRef = ref()
	const searchFormState = ref({})
	const selectedRowKeys = ref([])
	const options = {
		rowSelection: {
			onChange: (keys) => {
				selectedRowKeys.value = keys
			}
		}
	}

	const debugVisible = ref(false)
	const debugLoading = ref(false)
	const debugForm = ref({ id: '', target: '', paramsJson: '' })
	const debugResult = ref(null)

	const openDebugModal = (record) => {
		debugResult.value = null
		debugForm.value = {
			id: record.id,
			target: '',
			paramsJson: JSON.stringify({ system_name: '高校学业预警系统', student_name: '张三', course_name: '大学语文1' }, null, 2)
		}
		debugVisible.value = true
	}

	const runTestSend = (previewOnly) => {
		debugLoading.value = true
		bizMsgTemplateApi
			.templateTestSend({
				id: debugForm.value.id,
				target: debugForm.value.target,
				paramsJson: debugForm.value.paramsJson,
				previewOnly
			})
			.then((res) => {
				debugResult.value = res
				message.success(previewOnly ? '模板预览渲染成功' : '测试消息已发送')
			})
			.finally(() => {
				debugLoading.value = false
			})
	}

	const loadData = (parameter) => bizMsgTemplateApi.templatePage(Object.assign(parameter, searchFormState.value))

	const reset = () => {
		searchFormRef.value.resetFields()
		tableRef.value.refresh(true)
	}

	const removeOne = (record) => {
		bizMsgTemplateApi.templateDelete([{ id: record.id }]).then(() => tableRef.value.refresh(true))
	}

	const deleteBatch = (params) => {
		bizMsgTemplateApi.templateDelete(params).then(() => tableRef.value.clearRefreshSelected())
	}
</script>

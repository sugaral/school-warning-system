<template>
	<xn-form-container
		:title="formData.id ? '编辑消息模板' : '新增消息模板'"
		:width="580"
		:visible="visible"
		:destroy-on-close="true"
		@close="onClose"
	>
		<a-form ref="formRef" :model="formData" :rules="formRules" layout="vertical">
			<a-row :gutter="12">
				<a-col :span="12">
					<a-form-item label="通知渠道：" name="channel">
						<a-select v-model:value="formData.channel">
							<a-select-option value="email">邮件 (email)</a-select-option>
							<a-select-option value="sms">短信 (sms)</a-select-option>
							<a-select-option value="inbox">站内信 (inbox)</a-select-option>
							<a-select-option value="wechat">微信 (wechat)</a-select-option>
						</a-select>
					</a-form-item>
				</a-col>
				<a-col :span="12">
					<a-form-item label="模板编码：" name="templateCode">
						<a-input v-model:value="formData.templateCode" placeholder="例如：WARNING_NOTIFICATION" allow-clear />
					</a-form-item>
				</a-col>
			</a-row>
			<a-form-item label="模板标题：" name="title">
				<a-input v-model:value="formData.title" placeholder="例如：{system_name} 学业预警通知" allow-clear />
			</a-form-item>
			<a-form-item label="模板正文（支持 {变量名} 占位）：" name="content">
				<a-textarea v-model:value="formData.content" :rows="6" placeholder="请输入模板正文" />
			</a-form-item>
			<a-form-item label="状态：" name="status">
				<a-radio-group v-model:value="formData.status">
					<a-radio value="active">启用</a-radio>
					<a-radio value="inactive">停用</a-radio>
				</a-radio-group>
			</a-form-item>
		</a-form>
		<template #footer>
			<a-button class="xn-mr8" @click="onClose">关闭</a-button>
			<a-button type="primary" :loading="submitLoading" @click="onSubmit">保存</a-button>
		</template>
	</xn-form-container>
</template>

<script setup name="bizMsgTemplateForm">
	import { required } from '@/utils/formRules'
	import bizMsgTemplateApi from '@/api/biz/bizMsgTemplateApi'

	const emit = defineEmits({ successful: null })

	const visible = ref(false)
	const formRef = ref()
	const formData = ref({})
	const submitLoading = ref(false)

	const formRules = {
		channel: [required('请选择通知渠道')],
		templateCode: [required('请输入模板编码')],
		content: [required('请输入模板正文')]
	}

	const onOpen = (record) => {
		visible.value = true
		formData.value = { channel: 'email', status: 'active' }
		if (record) formData.value = Object.assign({}, record)
	}

	const onClose = () => {
		visible.value = false
	}

	const onSubmit = () => {
		formRef.value
			.validate()
			.then(() => {
				submitLoading.value = true
				bizMsgTemplateApi
					.submitForm(formData.value, !!formData.value.id)
					.then(() => {
						visible.value = false
						emit('successful')
					})
					.finally(() => {
						submitLoading.value = false
					})
			})
			.catch(() => {})
	}

	defineExpose({ onOpen })
</script>

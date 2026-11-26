<template>
	<xn-form-container
		:title="formData.id ? '编辑班级公告' : '发布班级公告'"
		:width="560"
		:visible="visible"
		:destroy-on-close="true"
		@close="onClose"
	>
		<a-form ref="formRef" :model="formData" :rules="formRules" layout="vertical">
			<a-form-item label="目标班级：" name="classId">
				<a-select
					v-model:value="formData.classId"
					:options="classOptions"
					:field-names="{ label: 'className', value: 'id' }"
					placeholder="请选择目标班级"
					show-search
					option-filter-prop="className"
				/>
			</a-form-item>
			<a-form-item label="公告标题：" name="title">
				<a-input v-model:value="formData.title" placeholder="请输入公告标题" allow-clear />
			</a-form-item>
			<a-form-item label="公告内容：" name="content">
				<a-textarea v-model:value="formData.content" :rows="6" placeholder="请输入公告正文内容" />
			</a-form-item>
		</a-form>
		<template #footer>
			<a-button class="xn-mr8" @click="onClose">关闭</a-button>
			<a-button type="primary" :loading="submitLoading" @click="onSubmit">发布</a-button>
		</template>
	</xn-form-container>
</template>

<script setup name="bizClassNoticeForm">
	import { required } from '@/utils/formRules'
	import bizClassNoticeApi from '@/api/biz/bizClassNoticeApi'
	import bizClassApi from '@/api/biz/bizClassApi'

	const emit = defineEmits({ successful: null })

	const visible = ref(false)
	const formRef = ref()
	const formData = ref({})
	const submitLoading = ref(false)
	const classOptions = ref([])

	const formRules = {
		classId: [required('请选择目标班级')],
		title: [required('请输入公告标题')],
		content: [required('请输入公告正文内容')]
	}

	const onOpen = (record) => {
		visible.value = true
		formData.value = {}
		if (record) formData.value = Object.assign({}, record)
		bizClassApi.clazzList().then((res) => {
			classOptions.value = res || []
		})
	}

	const onClose = () => {
		visible.value = false
	}

	const onSubmit = () => {
		formRef.value
			.validate()
			.then(() => {
				submitLoading.value = true
				bizClassNoticeApi
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
